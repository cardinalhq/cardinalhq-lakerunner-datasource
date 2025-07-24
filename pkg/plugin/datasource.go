package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

type queryModel struct{}

func (d *Datasource) query(_ context.Context, pCtx backend.PluginContext, query backend.DataQuery) backend.DataResponse {
	var response backend.DataResponse
	var qm queryModel

	err := json.Unmarshal(query.JSON, &qm)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("json unmarshal: %v", err.Error()))
	}

	frame := data.NewFrame("response")
	frame.Fields = append(frame.Fields,
		data.NewField("time", nil, []time.Time{query.TimeRange.From, query.TimeRange.To}),
		data.NewField("values", nil, []int64{10, 20}),
	)
	response.Frames = append(response.Frames, frame)
	return response
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
			out := &backend.CallResourceResponse{
				Status: resp.StatusCode,
				Body:   append([]byte(nil), buf[:n]...), 
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
