package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/cardinalhq/cardinalhq-datasource/pkg/models"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

// NewDatasource creates a new datasource instance.
func NewDatasource(_ context.Context, _ backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	return &Datasource{}, nil
}

// Datasource implements Grafana interfaces
type Datasource struct{}

func (d *Datasource) Dispose() {}

func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	response := backend.NewQueryDataResponse()
	for _, q := range req.Queries {
		res := d.query(ctx, req.PluginContext, q)
		response.Responses[q.RefID] = res
	}
	return response, nil
}

type queryModel struct {
	MetricName string `json:"metricName"`
}

func (d *Datasource) query(ctx context.Context, pCtx backend.PluginContext, query backend.DataQuery) backend.DataResponse {
	var response backend.DataResponse
	var qm queryModel

	err := json.Unmarshal(query.JSON, &qm)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("json unmarshal: %v", err.Error()))
	}

	config, err := models.LoadPluginSettings(*pCtx.DataSourceInstanceSettings)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, "Failed to load plugin settings")
	}

	startTime := query.TimeRange.From.UnixMilli()
	endTime := query.TimeRange.To.UnixMilli()
	path := "/api/v1/graph?s=" + strconv.FormatInt(startTime, 10) + "&e=" + strconv.FormatInt(endTime, 10)
	fullURL := strings.TrimRight(config.JsonData.CustomPath, "/") + path

	var body = map[string]interface{}{
		"baseExpressions": map[string]interface{}{
			"a": map[string]interface{}{
				"dataset": "metrics",
				"filter": map[string]interface{}{
					"k":         "_cardinalhq.name",
					"v":         []string{qm.MetricName},
					"op":        "eq",
					"dataType":  "string",
					"extracted": false,
					"computed":  false,
				},
				"chart": map[string]interface{}{
					"aggregation": "sum",
					"rollup":      "sum",
					"type":        "count",
					"groupBy":     []string{},
				},
			},
		},
	}

	method := http.MethodPost
	var bodyReader io.Reader
	bodyBytes, _ := json.Marshal(body)
	bodyReader = bytes.NewReader(bodyBytes)

	httpReq, err := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Failed to create request: %v", err))
	}

	httpReq.Header.Set("api-key", config.Secrets.ApiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Failed to create request: %v", err))
	}
	defer resp.Body.Close()

	reader := resp.Body
	buffer := ""
	buf := make([]byte, 32*1024)
	doneReceived := false

	timestamps := []time.Time{}
	values := []float64{}

	for {
		n, err := reader.Read(buf)
		if n > 0 {
			buffer += string(buf[:n])
			lines := strings.Split(buffer, "\n")
			buffer = lines[len(lines)-1]
			lines = lines[:len(lines)-1]

			for _, line := range lines {
				line = strings.TrimSpace(line)
				if !strings.HasPrefix(line, "data:") {
					continue
				}

				msgStr := strings.TrimSpace(strings.TrimPrefix(line, "data:"))

				var outer struct {
					Type    string          `json:"type"`
					Message json.RawMessage `json:"message"`
				}
				if err := json.Unmarshal([]byte(msgStr), &outer); err != nil {
					continue
				}
				if outer.Type == "done" {
					doneReceived = true
					continue
				}
				if outer.Type != "timeseries" {
					continue
				}

				var msg struct {
					Timestamp int64                  `json:"timestamp"`
					Value     float64                `json:"value"`
					Tags      map[string]interface{} `json:"tags"`
					Label     string                 `json:"label"`
				}
				if err := json.Unmarshal(outer.Message, &msg); err != nil {
					continue
				}

				ts := time.UnixMilli(msg.Timestamp)

				timestamps = append(timestamps, ts)
				values = append(values, msg.Value)
			}
		}

		if err != nil {
			if err == io.EOF {
				if doneReceived || len(response.Frames) > 0 {
					return response
				}
				return backend.ErrDataResponse(backend.StatusBadRequest, "Stream ended without data or done message")
			}
			return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error reading stream: %v", err))
		}

		if doneReceived {
			timeField := data.NewField("Time", nil, timestamps)
			valueField := data.NewField("Value", nil, values)
			frame := data.NewFrame(query.RefID, timeField, valueField)
			frame.RefID = query.RefID
			frame.Meta = &data.FrameMeta{PreferredVisualization: data.VisTypeGraph}
			response.Frames = append(response.Frames, frame)

			return response
		}
	}
}

func (d *Datasource) CheckHealth(_ context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	res := &backend.CheckHealthResult{}
	config, err := models.LoadPluginSettings(*req.PluginContext.DataSourceInstanceSettings)
	if err != nil {
		res.Status = backend.HealthStatusError
		res.Message = "Unable to load settings"
		return res, nil
	}
	if config.Secrets.ApiKey == "" {
		res.Status = backend.HealthStatusError
		res.Message = "API key is missing"
		return res, nil
	}
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "Data source is working",
	}, nil
}

var CallResourceHandler = backend.CallResourceHandlerFunc(func(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	switch req.Path {
	case "proxy-query", "proxy-stream":
		return handleProxyRequest(ctx, req, sender)
	default:
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusNotFound,
			Body:   []byte("Unsupported resource path"),
		})
	}
})

func handleProxyRequest(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	config, err := models.LoadPluginSettings(*req.PluginContext.DataSourceInstanceSettings)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusInternalServerError,
			Body:   []byte("Failed to load plugin settings"),
		})
	}

	var incoming struct {
		Path string      `json:"path"`
		Body interface{} `json:"body"`
	}
	if err := json.Unmarshal(req.Body, &incoming); err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusBadRequest,
			Body:   []byte("Invalid request body"),
		})
	}

	fullURL := strings.TrimRight(config.JsonData.CustomPath, "/") + incoming.Path

	method := http.MethodPost
	var bodyReader io.Reader
	if incoming.Body == nil {
		bodyReader = nil
	} else {
		bodyBytes, _ := json.Marshal(incoming.Body)
		bodyReader = bytes.NewReader(bodyBytes)
	}

	httpReq, _ := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
	httpReq.Header.Set("api-key", config.Secrets.ApiKey)
	if method == http.MethodPost {
		httpReq.Header.Set("Content-Type", "application/json")
	}

	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusBadGateway,
			Body:   []byte(fmt.Sprintf("Request failed: %v", err)),
		})
	}
	defer resp.Body.Close()

	first := true
	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			var parsed map[string]interface{}
			if jsonErr := json.Unmarshal(chunk, &parsed); jsonErr == nil {
				if msgType, ok := parsed["type"].(string); ok {
					switch msgType {
					case "waiting_scale_up":
						signal := map[string]string{"type": "waiting_scale_up"}
						signalBytes, _ := json.Marshal(signal)
						_ = sender.Send(&backend.CallResourceResponse{
							Status: 200,
							Body:   signalBytes,
							Headers: map[string][]string{
								"X-Event-Type": {"scale-up-waiting"},
							},
						})
						continue
					case "done":
						signal := map[string]string{"type": "done"}
						signalBytes, _ := json.Marshal(signal)
						_ = sender.Send(&backend.CallResourceResponse{
							Status: 200,
							Body:   signalBytes,
							Headers: map[string][]string{
								"X-Event-Type": {"scale-up-done"},
							},
						})
						continue
					}
				}
			}

			out := &backend.CallResourceResponse{
				Status: resp.StatusCode,
				Body:   append([]byte(nil), chunk...),
			}
			if first {
				out.Headers = map[string][]string{
					"Content-Type": resp.Header.Values("Content-Type"),
				}
				first = false
			}
			if sendErr := sender.Send(out); sendErr != nil {
				return sendErr
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}

			return sender.Send(&backend.CallResourceResponse{
				Status: http.StatusBadGateway,
				Body:   []byte(fmt.Sprintf("stream interrupted: %v", err)),
			})
		}
	}
	return nil
}
