package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
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

func NewDatasource(_ context.Context, _ backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	return &Datasource{}, nil
}

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
	Mode        string     `json:"mode"`
	MetricName  string     `json:"metricName"`
	MetricType  string     `json:"metricType"`
	Aggregation string     `json:"aggregation"`
	GroupBy     []string   `json:"groupBy"`
	Filters     []uiFilter `json:"filters"`
	QueryText   string     `json:"queryText"`
}

type uiFilter struct {
	Tag       string   `json:"tag"`
	Op        string   `json:"op"`
	Value     []string `json:"value"`
	DataType  string   `json:"dataType,omitempty"`
	Extracted bool     `json:"extracted,omitempty"`
	Computed  bool     `json:"computed,omitempty"`
}

var userLabelToInternal = map[string]string{
	"message": "_cardinalhq.message",
	"level":   "_cardinalhq.level",
}

func mapToInternalLabel(label string) string {
	if v, ok := userLabelToInternal[label]; ok {
		return v
	}
	return label
}

func toInternalLabel(s string) string {
	if s == "" || strings.HasPrefix(s, "_cardinalhq.") {
		return s
	}
	return "_cardinalhq." + s
}

func cleanFilters(in []uiFilter) []uiFilter {
	out := make([]uiFilter, 0, len(in))
	for _, f := range in {
		tag := strings.TrimSpace(f.Tag)
		hasVal := false
		for _, v := range f.Value {
			if strings.TrimSpace(v) != "" {
				hasVal = true
				break
			}
		}
		if tag != "" && hasVal {
			out = append(out, f)
		}
	}
	return out
}

func convertOpTS(op string) string {
	switch op {
	case "=":
		return "eq"
	case "!=":
		return "neq"
	case "in":
		return "in"
	case "not_in":
		return "not_in"
	case "contains":
		return "contains"
	case "not contains":
		return "not_contains"
	case "regex":
		return "regex"
	case "not regex":
		return "not_regex"
	case "has":
		return "has"
	default:
		return "eq"
	}
}

func convertFilterTS(f uiFilter) map[string]interface{} {
	return map[string]interface{}{
		"k":         mapToInternalLabel(f.Tag),
		"v":         f.Value,
		"op":        convertOpTS(f.Op),
		"dataType":  firstNonEmpty(f.DataType, "string"),
		"extracted": f.Extracted,
		"computed":  f.Computed,
	}
}

func buildNestedFilterTS(filters []uiFilter) map[string]interface{} {
	if len(filters) == 0 {
		return nil
	}
	if len(filters) == 1 {
		return convertFilterTS(filters[0])
	}
	block := map[string]interface{}{"op": "and"}
	for i, f := range filters {
		key := fmt.Sprintf("q%d", i+1)
		block[key] = convertFilterTS(f)
	}
	return block
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

func prettyLabel(s string) string {
	return strings.ReplaceAll(s, "_cardinalhq.", "")
}

func (d *Datasource) query(ctx context.Context, pCtx backend.PluginContext, query backend.DataQuery) backend.DataResponse {
	var response backend.DataResponse
	var qm queryModel

	if err := json.Unmarshal(query.JSON, &qm); err != nil {
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

	isMetrics := strings.EqualFold(qm.Mode, "metrics")
	qt := strings.TrimSpace(qm.QueryText)
	isLogsVolume := !isMetrics && (strings.EqualFold(qt, "volume") || qt == "")

	filters := cleanFilters(qm.Filters)

	if isMetrics && strings.TrimSpace(qm.MetricName) != "" {
		injected := uiFilter{
			Tag:      "_cardinalhq.name",
			Op:       "=",
			Value:    []string{qm.MetricName},
			DataType: "string",
		}
		filters = append([]uiFilter{injected}, filters...)
	}

	nested := buildNestedFilterTS(filters)

	groupBys := make([]string, 0, len(qm.GroupBy))
	for _, g := range qm.GroupBy {
		gt := strings.TrimSpace(g)
		if gt == "" {
			continue
		}
		switch gt {
		case "message", "level":
			groupBys = append(groupBys, mapToInternalLabel(gt))
		default:
			groupBys = append(groupBys, gt)
		}
	}
	if isLogsVolume && len(groupBys) == 0 {
		groupBys = []string{"_cardinalhq.level"}
	}

	agg := firstNonEmpty(qm.Aggregation, "sum")
	rangeMs := endTime - startTime
	var bucketSizeMs int64
	if query.Interval > 0 {
		bucketSizeMs = query.Interval.Milliseconds()
	}
	if bucketSizeMs <= 0 && rangeMs > 0 {
		mdp := query.MaxDataPoints
		if mdp <= 0 {
			mdp = 1100
		}
		if rangeMs/int64(mdp) < 1000 {
			bucketSizeMs = 1000
		} else {
			bucketSizeMs = rangeMs / int64(mdp)
		}
	}

	chart := map[string]interface{}{
		"aggregation":  agg,
		"rollup":       agg,
		"groupBys":     groupBys,
		"bucketSizeMs": bucketSizeMs,
	}
	dataset := "metrics"
	if isLogsVolume {
		dataset = "logs"
		chart["type"] = "count"
	} else {
		chart["type"] = "count"
	}

	expr := map[string]interface{}{
		"dataset":       dataset,
		"returnResults": true,
		"filter":        nested,
		"chart":         chart,
	}
	if strings.TrimSpace(qm.MetricType) != "" {
		expr["metricType"] = qm.MetricType
	}

	body := map[string]interface{}{"baseExpressions": map[string]interface{}{"a": expr}}
	bodyBytes, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, fullURL, bytes.NewReader(bodyBytes))
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

	type pointSeries struct {
		times []time.Time
		vals  []float64
	}
	series := map[string]*pointSeries{}

	sseSamples := 0
	const sseSampleMax = 5

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

				if sseSamples < sseSampleMax {
					sseSamples++
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

				if isLogsVolume {
					if name, ok := msg.Tags["name"].(string); ok && name != "log.events" {
						continue
					}
				}

				ts := time.UnixMilli(msg.Timestamp)
				lbl := strings.TrimSpace(msg.Label)
				if lbl == "" {
					if len(groupBys) > 0 && msg.Tags != nil {
						parts := make([]string, 0, len(groupBys))
						for _, key := range groupBys {
							pretty := strings.TrimPrefix(key, "_cardinalhq.")
							var val string
							if v, ok := msg.Tags[key]; ok {
								val = fmt.Sprint(v)
							} else if v, ok := msg.Tags[pretty]; ok {
								val = fmt.Sprint(v)
							}
							if val == "" {
								val = "unknown"
							}
							parts = append(parts, fmt.Sprintf("%s=%s", pretty, val))
						}
						lbl = strings.Join(parts, ", ")
					} else {
						lbl = qm.MetricName
					}
				}
				lbl = prettyLabel(lbl)

				if _, ok := series[lbl]; !ok {
					series[lbl] = &pointSeries{}
				}
				series[lbl].times = append(series[lbl].times, ts)
				series[lbl].vals = append(series[lbl].vals, msg.Value)
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
			for label, s := range series {
				type pt struct {
					t time.Time
					v float64
				}
				pts := make([]pt, len(s.times))
				for i := range s.times {
					pts[i] = pt{t: s.times[i], v: s.vals[i]}
				}
				sort.Slice(pts, func(i, j int) bool { return pts[i].t.Before(pts[j].t) })

				outTimes := make([]time.Time, 0, len(pts))
				outVals := make([]float64, 0, len(pts))
				for _, p := range pts {
					n := len(outTimes)
					if n > 0 && outTimes[n-1].Equal(p.t) {
						if isLogsVolume {
							outVals[n-1] = p.v
						} else {
							outVals[n-1] += p.v
						}
					} else {
						outTimes = append(outTimes, p.t)
						outVals = append(outVals, p.v)
					}
				}

				timeField := data.NewField("Time", nil, outTimes)
				valueField := data.NewField("Value", nil, outVals)
				valueField.Config = &data.FieldConfig{
					DisplayNameFromDS: label,
				}
				if isLogsVolume {
					valueField.Config.Custom = map[string]any{
						"drawStyle":    "bars",
						"lineWidth":    0,
						"fillOpacity":  80,
						"showPoints":   "never",
						"barAlignment": 0,
						"stacking": map[string]any{
							"mode": "normal",
						},
					}
				}

				frame := data.NewFrame(query.RefID, timeField, valueField)
				frame.RefID = query.RefID
				frame.Meta = &data.FrameMeta{PreferredVisualization: data.VisTypeGraph}
				response.Frames = append(response.Frames, frame)
			}
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
	case "proxy-query", "proxy-stream", "proxy-promql":
		return handleProxyRequest(ctx, req, sender)
	default:
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusNotFound,
			Body:   []byte("Unsupported resource path"),
		})
	}
})

// Shared http.Client with pooled connections to reduce handshake/TCB churn across calls
var httpClient = &http.Client{
	Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DisableCompression:    true, // don't auto-gzip-decompress SSE
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ForceAttemptHTTP2:     true,
	},
}

func handleProxyRequest(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	config, err := models.LoadPluginSettings(*req.PluginContext.DataSourceInstanceSettings)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusInternalServerError, Body: []byte("Failed to load plugin settings")})
	}

	var incoming struct {
		Path string          `json:"path"`
		Body json.RawMessage `json:"body"`
	}
	if err := json.Unmarshal(req.Body, &incoming); err != nil {
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusBadRequest, Body: []byte("Invalid request body")})
	}
	var basePath string
	if req.Path == "proxy-promql" && config.JsonData.PromQLPath != "" {
		basePath = config.JsonData.PromQLPath
	} else {
		basePath = config.JsonData.CustomPath
	}

	fullURL := strings.TrimRight(basePath, "/") + incoming.Path

	var bodyReader io.Reader
	if len(incoming.Body) > 0 && string(incoming.Body) != "null" {
		bodyReader = bytes.NewReader(incoming.Body)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, fullURL, bodyReader)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusBadGateway, Body: []byte("Failed to build request")})
	}
	httpReq.Header.Set("api-key", config.Secrets.ApiKey)
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Accept-Encoding", "identity") // avoid gzip for SSE
	if bodyReader != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	httpReq.Header.Set("Cache-Control", "no-cache")
	httpReq.Header.Set("Connection", "keep-alive")

	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusBadGateway, Body: []byte(fmt.Sprintf("Request failed: %v", err))})
	}
	defer resp.Body.Close()

	first := true
	buf := make([]byte, 64*1024)

	scaleUpWaiting := []byte("data: {\"type\":\"waiting_scale_up\"}\n\n")

	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			chunk := buf[:n]

			if bytes.Contains(chunk, []byte(`"type":"waiting_scale_up"`)) {
				_ = sender.Send(&backend.CallResourceResponse{
					Status: 200, Body: scaleUpWaiting,
					Headers: map[string][]string{"X-Event-Type": {"scale-up-waiting"}},
				})
			}

			out := &backend.CallResourceResponse{
				Status: resp.StatusCode,
				Body:   chunk,
			}
			if first {
				h := map[string][]string{}
				if v := resp.Header.Values("Content-Type"); len(v) > 0 {
					h["Content-Type"] = v
				}
				if v := resp.Header.Values("Cache-Control"); len(v) > 0 {
					h["Cache-Control"] = v
				}
				if v := resp.Header.Values("Connection"); len(v) > 0 {
					h["Connection"] = v
				}
				if v := resp.Header.Values("Transfer-Encoding"); len(v) > 0 {
					h["Transfer-Encoding"] = v
				}
				if v := resp.Header.Values("Content-Encoding"); len(v) > 0 {
					h["Content-Encoding"] = v
				}
				out.Headers = h
				first = false
			}
			if sendErr := sender.Send(out); sendErr != nil {
				return sendErr
			}
		}
		if rerr != nil {
			if rerr == io.EOF {
				break
			}
			return sender.Send(&backend.CallResourceResponse{
				Status: http.StatusBadGateway,
				Body:   []byte(fmt.Sprintf("stream interrupted: %v", rerr)),
			})
		}
	}
	return nil
}
