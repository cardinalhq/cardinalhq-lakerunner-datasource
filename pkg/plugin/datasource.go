// Copyright (C) 2025-2026 CardinalHQ, Inc
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, version 3.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.

package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/cardinalhq/cardinalhq-datasource/pkg/models"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
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
	Mode             string     `json:"mode"`
	MetricName       string     `json:"metricName"`
	MetricType       string     `json:"metricType"`
	Aggregation      string     `json:"aggregation"`
	GroupBy          []string   `json:"groupBy"`
	Filters          []uiFilter `json:"filters"`
	QueryText        string     `json:"queryText"`
	PromqlOutput     string     `json:"promqlOutput"`
	LegendFormat     string     `json:"legendFormat"`
	ValueAs          string     `json:"valueAs"`
	LogqlOutput      string     `json:"logqlOutput"`
	LogqlAggregation string     `json:"logqlAggregation"`
	LogqlBuilderExp  string     `json:"logqlBuilderExp"`
	LogqlSubTab      string     `json:"logqlSubTab"`
}

type uiFilter struct {
	Tag       string   `json:"tag"`
	Op        string   `json:"op"`
	Value     []string `json:"value"`
	DataType  string   `json:"dataType,omitempty"`
	Extracted bool     `json:"extracted,omitempty"`
	Computed  bool     `json:"computed,omitempty"`
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

// escapePromQLValue escapes a string value for use in a PromQL label matcher
func escapePromQLValue(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return s
}

// isValidPromQLMetricName checks if a metric name is valid PromQL identifier
// Valid names match: [a-zA-Z_:][a-zA-Z0-9_:]*
func isValidPromQLMetricName(name string) bool {
	if name == "" {
		return false
	}
	for i, r := range name {
		if i == 0 {
			if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_' || r == ':') {
				return false
			}
		} else {
			if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == ':') {
				return false
			}
		}
	}
	return true
}

// buildPromQL constructs a PromQL query from the query builder model
func buildPromQL(qm queryModel) string {
	metricName := strings.TrimSpace(qm.MetricName)
	agg := strings.TrimSpace(qm.Aggregation)
	valueAs := strings.TrimSpace(qm.ValueAs)

	// Build filter clauses
	var clauses []string
	for _, f := range qm.Filters {
		tag := strings.TrimSpace(f.Tag)
		if tag == "" {
			continue
		}
		// Get first non-empty value
		var val string
		for _, v := range f.Value {
			if strings.TrimSpace(v) != "" {
				val = strings.TrimSpace(v)
				break
			}
		}
		if val == "" && f.Op != "!=" && f.Op != "neq" {
			continue
		}

		// Normalize the label name (quote if contains dots)
		label := tag
		if strings.Contains(tag, ".") {
			label = `"` + tag + `"`
		}

		escaped := escapePromQLValue(val)
		switch f.Op {
		case "=", "eq":
			clauses = append(clauses, fmt.Sprintf(`%s="%s"`, label, escaped))
		case "!=", "neq":
			clauses = append(clauses, fmt.Sprintf(`%s!="%s"`, label, escaped))
		case "regex", "=~":
			clauses = append(clauses, fmt.Sprintf(`%s=~"%s"`, label, escaped))
		case "not regex", "!~", "not_regex":
			clauses = append(clauses, fmt.Sprintf(`%s!~"%s"`, label, escaped))
		case "in":
			// Build regex alternation for "in"
			var vals []string
			for _, v := range f.Value {
				if strings.TrimSpace(v) != "" {
					vals = append(vals, escapePromQLValue(strings.TrimSpace(v)))
				}
			}
			if len(vals) > 0 {
				clauses = append(clauses, fmt.Sprintf(`%s=~"%s"`, label, strings.Join(vals, "|")))
			}
		case "not_in":
			var vals []string
			for _, v := range f.Value {
				if strings.TrimSpace(v) != "" {
					vals = append(vals, escapePromQLValue(strings.TrimSpace(v)))
				}
			}
			if len(vals) > 0 {
				clauses = append(clauses, fmt.Sprintf(`%s!~"%s"`, label, strings.Join(vals, "|")))
			}
		case "contains":
			clauses = append(clauses, fmt.Sprintf(`%s=~".*%s.*"`, label, escaped))
		case "not contains", "not_contains":
			clauses = append(clauses, fmt.Sprintf(`%s!~".*%s.*"`, label, escaped))
		default:
			clauses = append(clauses, fmt.Sprintf(`%s="%s"`, label, escaped))
		}
	}

	// Build selector
	var selector string
	if metricName != "" {
		// Check if metric name is a valid PromQL identifier
		// If not (e.g., contains dots like k8s.cpu.total), use __name__ matcher
		if isValidPromQLMetricName(metricName) {
			if len(clauses) > 0 {
				selector = fmt.Sprintf("%s{%s}", metricName, strings.Join(clauses, ", "))
			} else {
				selector = metricName
			}
		} else {
			// Use __name__ matcher for invalid metric names (e.g., with dots)
			nameClause := fmt.Sprintf(`__name__="%s"`, escapePromQLValue(metricName))
			allClauses := append([]string{nameClause}, clauses...)
			selector = fmt.Sprintf("{%s}", strings.Join(allClauses, ", "))
		}
	} else if len(clauses) > 0 {
		selector = fmt.Sprintf("{%s}", strings.Join(clauses, ", "))
	} else {
		return ""
	}

	// Apply valueAs transformations
	inner := selector
	switch valueAs {
	case "rates_per_second":
		inner = fmt.Sprintf("rate(%s[5m])", selector)
	case "count_over_time":
		inner = fmt.Sprintf("count_over_time(%s[5m])", selector)
	}

	// Apply aggregation
	if agg == "" {
		return inner
	}

	groupBys := make([]string, 0, len(qm.GroupBy))
	for _, g := range qm.GroupBy {
		gt := strings.TrimSpace(g)
		if gt != "" {
			if strings.Contains(gt, ".") {
				groupBys = append(groupBys, `"`+gt+`"`)
			} else {
				groupBys = append(groupBys, gt)
			}
		}
	}

	if len(groupBys) > 0 {
		return fmt.Sprintf("%s by (%s)(%s)", agg, strings.Join(groupBys, ","), inner)
	}
	return fmt.Sprintf("%s(%s)", agg, inner)
}

// normalizeLogTag converts tag names to LogQL format (dots become underscores)
func normalizeLogTag(tag string) string {
	return strings.ReplaceAll(tag, ".", "_")
}

// buildLogQL constructs a LogQL query from the query builder model
func buildLogQL(qm queryModel, window string) string {
	if window == "" {
		window = "5m"
	}

	// Build label matchers for the selector
	var labelMatchers []string
	var lineFilters []string

	for _, f := range qm.Filters {
		tag := strings.TrimSpace(f.Tag)
		if tag == "" {
			continue
		}

		// Get values
		var vals []string
		for _, v := range f.Value {
			if strings.TrimSpace(v) != "" {
				vals = append(vals, strings.TrimSpace(v))
			}
		}
		if len(vals) == 0 && f.Op != "!=" && f.Op != "neq" && f.Op != "has" {
			continue
		}

		first := ""
		if len(vals) > 0 {
			first = vals[0]
		}

		// Handle message as line filter instead of label matcher
		if tag == "message" {
			if first != "" {
				switch f.Op {
				case "contains":
					lineFilters = append(lineFilters, fmt.Sprintf(`|= "%s"`, escapePromQLValue(first)))
				case "not contains", "not_contains":
					lineFilters = append(lineFilters, fmt.Sprintf(`!= "%s"`, escapePromQLValue(first)))
				case "regex", "=~":
					lineFilters = append(lineFilters, fmt.Sprintf(`|~ "%s"`, escapePromQLValue(first)))
				case "not regex", "not_regex", "!~":
					lineFilters = append(lineFilters, fmt.Sprintf(`!~ "%s"`, escapePromQLValue(first)))
				}
			}
			continue
		}

		// Normalize tag name for LogQL
		safeTag := normalizeLogTag(tag)

		switch f.Op {
		case "=", "eq":
			labelMatchers = append(labelMatchers, fmt.Sprintf(`%s="%s"`, safeTag, escapePromQLValue(first)))
		case "!=", "neq":
			labelMatchers = append(labelMatchers, fmt.Sprintf(`%s!="%s"`, safeTag, escapePromQLValue(first)))
		case "in":
			if len(vals) > 0 {
				escaped := make([]string, len(vals))
				for i, v := range vals {
					escaped[i] = escapePromQLValue(v)
				}
				labelMatchers = append(labelMatchers, fmt.Sprintf(`%s=~"^(?:%s)$"`, safeTag, strings.Join(escaped, "|")))
			}
		case "not_in":
			if len(vals) > 0 {
				escaped := make([]string, len(vals))
				for i, v := range vals {
					escaped[i] = escapePromQLValue(v)
				}
				labelMatchers = append(labelMatchers, fmt.Sprintf(`%s!~"^(?:%s)$"`, safeTag, strings.Join(escaped, "|")))
			}
		case "contains":
			labelMatchers = append(labelMatchers, fmt.Sprintf(`%s=~"%s"`, safeTag, escapePromQLValue(first)))
		case "not contains", "not_contains":
			labelMatchers = append(labelMatchers, fmt.Sprintf(`%s!~"%s"`, safeTag, escapePromQLValue(first)))
		case "regex", "=~":
			labelMatchers = append(labelMatchers, fmt.Sprintf(`%s=~"%s"`, safeTag, first)) // Don't escape regex
		case "not regex", "not_regex", "!~":
			labelMatchers = append(labelMatchers, fmt.Sprintf(`%s!~"%s"`, safeTag, first))
		case "has":
			labelMatchers = append(labelMatchers, fmt.Sprintf(`%s!=""`, safeTag))
		default:
			if first != "" {
				labelMatchers = append(labelMatchers, fmt.Sprintf(`%s="%s"`, safeTag, escapePromQLValue(first)))
			}
		}
	}

	// Build selector
	selector := "{" + strings.Join(labelMatchers, ", ") + "}"

	// Add line filters (pipeline)
	baseExpr := selector
	if len(lineFilters) > 0 {
		baseExpr = selector + " " + strings.Join(lineFilters, " ")
	}

	// Apply valueAs transformation
	valueExpr := baseExpr
	switch qm.ValueAs {
	case "rates_per_second":
		valueExpr = fmt.Sprintf("rate(%s[%s])", baseExpr, window)
	case "count_over_time":
		valueExpr = fmt.Sprintf("count_over_time(%s[%s])", baseExpr, window)
	case "last_over_time":
		valueExpr = fmt.Sprintf("last_over_time(%s[%s])", baseExpr, window)
	}

	// Build group by clause
	groupBys := make([]string, 0, len(qm.GroupBy))
	for _, g := range qm.GroupBy {
		gt := strings.TrimSpace(g)
		if gt != "" {
			groupBys = append(groupBys, normalizeLogTag(gt))
		}
	}
	byClause := ""
	if len(groupBys) > 0 {
		byClause = fmt.Sprintf(" by (%s)", strings.Join(groupBys, ","))
	}

	// Apply aggregation
	agg := strings.TrimSpace(qm.LogqlAggregation)
	if agg == "" {
		agg = strings.TrimSpace(qm.Aggregation) // Fallback to general aggregation
	}

	if agg != "" {
		return fmt.Sprintf("%s%s(%s)", agg, byClause, valueExpr)
	}

	// If no aggregation but has groupBy and valueAs, default to sum
	if len(groupBys) > 0 && (qm.ValueAs == "rates_per_second" || qm.ValueAs == "count_over_time") {
		return fmt.Sprintf("sum%s(%s)", byClause, valueExpr)
	}

	return valueExpr
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
		"k":         f.Tag,
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

var legendFormatRe = regexp.MustCompile(`\{\{([\w.:\-]+)\}\}`)

func applyLegendFormat(format string, tags map[string]any) string {
	if format == "" {
		return ""
	}
	if len(tags) == 0 {
		return ""
	}
	return legendFormatRe.ReplaceAllStringFunc(format, func(match string) string {
		key := match[2 : len(match)-2]
		if v, ok := tags[key]; ok {
			return fmt.Sprint(v)
		}
		return match
	})
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
	fullURL := strings.TrimRight(config.JsonData.CustomPath, "/")

	isMetrics := strings.EqualFold(qm.Mode, "metrics")
	isLogs := strings.EqualFold(qm.Mode, "logs")
	qt := strings.TrimSpace(qm.QueryText)

	// Debug: log the raw query JSON and parsed fields
	log.DefaultLogger.Debug("Query model received",
		"rawJSON", string(query.JSON),
		"mode", qm.Mode,
		"queryText", qm.QueryText,
		"logqlAggregation", qm.LogqlAggregation,
		"valueAs", qm.ValueAs,
		"logqlOutput", qm.LogqlOutput,
		"logqlBuilderExp", qm.LogqlBuilderExp,
		"aggregation", qm.Aggregation,
		"metricName", qm.MetricName,
		"filters", fmt.Sprintf("%+v", qm.Filters),
	)

	// Detect if this is a log alert query
	// Has explicit aggregation OR has logqlBuilderExp (which we'll wrap in count_over_time for alerting)
	hasLogAggregation := strings.TrimSpace(qm.LogqlAggregation) != "" ||
		strings.TrimSpace(qm.ValueAs) != "" ||
		strings.TrimSpace(qm.LogqlOutput) != ""
	hasLogqlBuilder := strings.TrimSpace(qm.LogqlBuilderExp) != ""
	// For alerting: any logs query with filters or logqlBuilderExp that's not explicitly "volume"
	isLogAlert := isLogs && (hasLogAggregation || hasLogqlBuilder) && !strings.EqualFold(qt, "volume")
	isLogsVolume := !isMetrics && !isLogAlert && (strings.EqualFold(qt, "volume") || qt == "")

	log.DefaultLogger.Debug("Query routing decision",
		"isMetrics", isMetrics,
		"isLogs", isLogs,
		"hasLogAggregation", hasLogAggregation,
		"hasLogqlBuilder", hasLogqlBuilder,
		"isLogAlert", isLogAlert,
		"isLogsVolume", isLogsVolume,
	)

	// For metrics queries, use PromQL format like the frontend does
	if isMetrics {
		// Use promqlOutput if provided, otherwise build from query model
		promql := strings.TrimSpace(qm.PromqlOutput)
		if promql == "" {
			promql = buildPromQL(qm)
		}
		if promql == "" {
			return backend.ErrDataResponse(backend.StatusBadRequest, "No metric query specified")
		}

		body := map[string]interface{}{
			"s": fmt.Sprintf("%d", startTime),
			"e": fmt.Sprintf("%d", endTime),
			"q": promql,
		}
		bodyBytes, _ := json.Marshal(body)
		endpoint := fullURL + "/api/v1/metrics/query"
		log.DefaultLogger.Debug("Making metrics request", "endpoint", endpoint, "promql", promql, "body", string(bodyBytes))
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
		if err != nil {
			return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Failed to create request: %v", err))
		}
		httpReq.Header.Set("x-cardinalhq-api-key", config.Secrets.ApiKey)
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Accept", "text/event-stream")

		resp, err := http.DefaultClient.Do(httpReq)
		if err != nil {
			return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Failed to execute request: %v", err))
		}
		defer resp.Body.Close()

		log.DefaultLogger.Debug("SSE response received", "status", resp.StatusCode, "contentType", resp.Header.Get("Content-Type"))

		// Check for non-2xx response status
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			bodyBytes, _ := io.ReadAll(resp.Body)
			return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("API request failed with status %d: %s", resp.StatusCode, string(bodyBytes)))
		}

		// Parse SSE response for metrics (expects "result" type messages like frontend)
		type seriesData struct {
			timestamps []int64
			values     []float64
			tags       map[string]any
		}
		frameData := map[string]*seriesData{}

		reader := resp.Body
		buffer := ""
		buf := make([]byte, 32*1024)
		sseSamples := 0
		const sseSampleMax = 5
		doneReceived := false

		for {
			n, rerr := reader.Read(buf)
			if n > 0 {
				buffer += string(buf[:n])
				lines := strings.Split(buffer, "\n")
				buffer = lines[len(lines)-1]
				lines = lines[:len(lines)-1]

				for _, rawLine := range lines {
					line := strings.TrimSpace(rawLine)
					if !strings.HasPrefix(line, "data:") {
						continue
					}
					msgStr := strings.TrimSpace(strings.TrimPrefix(line, "data:"))

					var parsed struct {
						Type string `json:"type"`
						Data struct {
							Timestamp json.Number    `json:"timestamp"`
							Value     json.Number    `json:"value"`
							Label     string         `json:"label"`
							Tags      map[string]any `json:"tags"`
						} `json:"data"`
					}
					if err := json.Unmarshal([]byte(msgStr), &parsed); err != nil {
						continue
					}

					if sseSamples < sseSampleMax {
						log.DefaultLogger.Debug("SSE message received", "type", parsed.Type, "sample", sseSamples, "raw", msgStr)
						sseSamples++
					}

					if parsed.Type == "done" || parsed.Type == "end" {
						doneReceived = true
						break
					}
					if parsed.Type == "heartbeat" {
						continue
					}

					// Handle "result" type (like frontend) and "timeseries" type (legacy)
					if parsed.Type != "result" && parsed.Type != "timeseries" {
						continue
					}

					ts, err := parsed.Data.Timestamp.Int64()
					if err != nil {
						continue
					}
					val, err := parsed.Data.Value.Float64()
					if err != nil {
						continue
					}

					label := parsed.Data.Label
					if label == "" {
						label = qm.MetricName
					}
					if label == "" {
						label = "value"
					}

					if frameData[label] == nil {
						frameData[label] = &seriesData{tags: parsed.Data.Tags}
					}
					frameData[label].timestamps = append(frameData[label].timestamps, ts)
					frameData[label].values = append(frameData[label].values, val)
				}
			}

			if rerr != nil {
				if rerr == io.EOF {
					log.DefaultLogger.Debug("SSE stream EOF", "doneReceived", doneReceived, "seriesCount", len(frameData), "sseSamples", sseSamples)
					break
				}
				return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error reading stream: %v", rerr))
			}
			if doneReceived {
				break
			}
		}

		// Build data frames from collected series
		for label, sd := range frameData {
			// Sort by timestamp
			type pt struct {
				t int64
				v float64
			}
			pts := make([]pt, len(sd.timestamps))
			for i := range sd.timestamps {
				pts[i] = pt{t: sd.timestamps[i], v: sd.values[i]}
			}
			sort.Slice(pts, func(i, j int) bool { return pts[i].t < pts[j].t })

			times := make([]time.Time, len(pts))
			vals := make([]float64, len(pts))
			for i, p := range pts {
				times[i] = time.UnixMilli(p.t)
				vals[i] = p.v
			}

			timeField := data.NewField("Time", nil, times)

			// Convert tags to data.Labels (map[string]string) for Grafana field labels
			var fieldLabels data.Labels
			if len(sd.tags) > 0 {
				fieldLabels = make(data.Labels, len(sd.tags))
				for k, v := range sd.tags {
					fieldLabels[k] = fmt.Sprint(v)
				}
			}

			// Apply legendFormat template substitution
			displayName := label
			if lf := applyLegendFormat(qm.LegendFormat, sd.tags); lf != "" {
				displayName = lf
			}

			valueField := data.NewField("Value", fieldLabels, vals)
			valueField.Config = &data.FieldConfig{DisplayNameFromDS: displayName}

			frame := data.NewFrame(query.RefID, timeField, valueField)
			frame.RefID = query.RefID
			frame.Meta = &data.FrameMeta{PreferredVisualization: data.VisTypeGraph}
			response.Frames = append(response.Frames, frame)
		}

		return response
	}

	// For log alert queries, use LogQL format like the frontend does
	if isLogAlert {
		// Use logqlOutput if provided, otherwise use logqlBuilderExp, otherwise build from query model
		logql := strings.TrimSpace(qm.LogqlOutput)
		if logql == "" {
			logql = buildLogQL(qm, "5m")
		}
		// If buildLogQL returns empty/just selector, use logqlBuilderExp
		if logql == "" || logql == "{}" {
			logql = strings.TrimSpace(qm.LogqlBuilderExp)
		}
		if logql == "" || logql == "{}" {
			return backend.ErrDataResponse(backend.StatusBadRequest, "No log query specified")
		}
		// Check if the query is just a stream selector (no aggregation function)
		// For alerting, we need numeric timeseries data, so wrap in count_over_time
		isJustSelector := strings.HasPrefix(logql, "{") && !strings.Contains(logql, "(")
		if isJustSelector {
			logql = fmt.Sprintf("sum(count_over_time(%s[5m]))", logql)
		}
		log.DefaultLogger.Debug("Log alert query built", "logql", logql, "wasJustSelector", isJustSelector)

		body := map[string]interface{}{
			"s": fmt.Sprintf("%d", startTime),
			"e": fmt.Sprintf("%d", endTime),
			"q": logql,
		}
		bodyBytes, _ := json.Marshal(body)
		endpoint := fullURL + "/api/v1/logs/query"
		log.DefaultLogger.Debug("Making logs alert request", "endpoint", endpoint, "logql", logql, "body", string(bodyBytes))
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
		if err != nil {
			return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Failed to create request: %v", err))
		}
		httpReq.Header.Set("x-cardinalhq-api-key", config.Secrets.ApiKey)
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Accept", "text/event-stream")

		resp, err := http.DefaultClient.Do(httpReq)
		if err != nil {
			return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Failed to execute request: %v", err))
		}
		defer resp.Body.Close()

		log.DefaultLogger.Debug("SSE response received", "status", resp.StatusCode, "contentType", resp.Header.Get("Content-Type"))

		// Check for non-2xx response status
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			bodyBytes, _ := io.ReadAll(resp.Body)
			return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("API request failed with status %d: %s", resp.StatusCode, string(bodyBytes)))
		}

		// Parse SSE response for logs (expects "result" type messages like frontend)
		type seriesData struct {
			timestamps []int64
			values     []float64
		}
		frameData := map[string]*seriesData{}

		reader := resp.Body
		buffer := ""
		buf := make([]byte, 32*1024)
		sseSamples := 0
		const sseSampleMax = 5
		doneReceived := false

		for {
			n, rerr := reader.Read(buf)
			if n > 0 {
				buffer += string(buf[:n])
				lines := strings.Split(buffer, "\n")
				buffer = lines[len(lines)-1]
				lines = lines[:len(lines)-1]

				for _, rawLine := range lines {
					line := strings.TrimSpace(rawLine)
					if !strings.HasPrefix(line, "data:") {
						continue
					}
					msgStr := strings.TrimSpace(strings.TrimPrefix(line, "data:"))

					var parsed struct {
						Type string `json:"type"`
						Data struct {
							Timestamp json.Number `json:"timestamp"`
							Value     json.Number `json:"value"`
							Label     string      `json:"label"`
						} `json:"data"`
					}
					if err := json.Unmarshal([]byte(msgStr), &parsed); err != nil {
						continue
					}

					if sseSamples < sseSampleMax {
						log.DefaultLogger.Debug("SSE message received", "type", parsed.Type, "sample", sseSamples, "raw", msgStr)
						sseSamples++
					}

					if parsed.Type == "done" || parsed.Type == "end" {
						doneReceived = true
						break
					}
					if parsed.Type == "heartbeat" {
						continue
					}

					// Handle "result" type messages
					if parsed.Type != "result" {
						continue
					}

					ts, err := parsed.Data.Timestamp.Int64()
					if err != nil {
						continue
					}
					val, err := parsed.Data.Value.Float64()
					if err != nil {
						continue
					}

					label := parsed.Data.Label
					if label == "" {
						label = "logs"
					}

					if frameData[label] == nil {
						frameData[label] = &seriesData{}
					}
					frameData[label].timestamps = append(frameData[label].timestamps, ts)
					frameData[label].values = append(frameData[label].values, val)
				}
			}

			if rerr != nil {
				if rerr == io.EOF {
					log.DefaultLogger.Debug("SSE stream EOF", "doneReceived", doneReceived, "seriesCount", len(frameData), "sseSamples", sseSamples)
					break
				}
				return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error reading stream: %v", rerr))
			}
			if doneReceived {
				break
			}
		}

		// Build data frames from collected series
		for label, sd := range frameData {
			// Sort by timestamp
			type pt struct {
				t int64
				v float64
			}
			pts := make([]pt, len(sd.timestamps))
			for i := range sd.timestamps {
				pts[i] = pt{t: sd.timestamps[i], v: sd.values[i]}
			}
			sort.Slice(pts, func(i, j int) bool { return pts[i].t < pts[j].t })

			times := make([]time.Time, len(pts))
			vals := make([]float64, len(pts))
			for i, p := range pts {
				times[i] = time.UnixMilli(p.t)
				vals[i] = p.v
			}

			timeField := data.NewField("Time", nil, times)
			valueField := data.NewField("Value", nil, vals)
			valueField.Config = &data.FieldConfig{DisplayNameFromDS: label}

			frame := data.NewFrame(query.RefID, timeField, valueField)
			frame.RefID = query.RefID
			frame.Meta = &data.FrameMeta{PreferredVisualization: data.VisTypeGraph}
			response.Frames = append(response.Frames, frame)
		}

		return response
	}

	// For logs volume queries, keep the existing baseExpressions format
	filters := cleanFilters(qm.Filters)

	nested := buildNestedFilterTS(filters)

	groupBys := make([]string, 0, len(qm.GroupBy))
	for _, g := range qm.GroupBy {
		gt := strings.TrimSpace(g)
		if gt != "" {
			groupBys = append(groupBys, gt)
		}
	}
	if isLogsVolume && len(groupBys) == 0 {
		groupBys = []string{"level"}
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
	dataset := "logs"
	chart["type"] = "count"

	expr := map[string]interface{}{
		"dataset":       dataset,
		"returnResults": true,
		"filter":        nested,
		"chart":         chart,
	}

	body := map[string]interface{}{"baseExpressions": map[string]interface{}{"a": expr}}
	bodyBytes, _ := json.Marshal(body)
	endpoint := fullURL + "/api/v1/logs/query"
	log.DefaultLogger.Debug("Making logs volume request", "endpoint", endpoint, "body", string(bodyBytes))
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Failed to create request: %v", err))
	}
	httpReq.Header.Set("x-cardinalhq-api-key", config.Secrets.ApiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Failed to create request: %v", err))
	}
	defer resp.Body.Close()

	log.DefaultLogger.Debug("SSE response received", "status", resp.StatusCode, "contentType", resp.Header.Get("Content-Type"))

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
					log.DefaultLogger.Debug("SSE message received", "type", outer.Type, "sample", sseSamples, "raw", msgStr)
					sseSamples++
				}

				if outer.Type == "done" || outer.Type == "end" {
					log.DefaultLogger.Debug("SSE done message received")
					doneReceived = true
					break
				}
				if outer.Type != "timeseries" {
					log.DefaultLogger.Debug("SSE skipping non-timeseries message", "type", outer.Type)
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
				log.DefaultLogger.Debug("SSE stream EOF", "doneReceived", doneReceived, "framesCount", len(response.Frames), "seriesCount", len(series), "sseSamples", sseSamples)
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

func (d *Datasource) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	config, err := models.LoadPluginSettings(*req.PluginContext.DataSourceInstanceSettings)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: "Unable to load settings",
		}, nil
	}
	if strings.TrimSpace(config.JsonData.CustomPath) == "" {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: "URL is missing",
		}, nil
	}
	if config.Secrets.ApiKey == "" {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: "API key is missing",
		}, nil
	}

	// Validate connection by calling the ping endpoint
	pingURL := strings.TrimRight(config.JsonData.CustomPath, "/") + "/api/v1/ping"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, pingURL, nil)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("Invalid URL: %v", err),
		}, nil
	}
	httpReq.Header.Set("x-cardinalhq-api-key", config.Secrets.ApiKey)

	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("Connection failed: %v", err),
		}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: "Invalid API key",
		}, nil
	}
	if resp.StatusCode == http.StatusNotFound {
		// Older API versions may not have the ping endpoint - allow with warning
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusOk,
			Message: "Connected (warning: unable to fully validate - server may need upgrade)",
		}, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("Server returned status %d: %s", resp.StatusCode, string(body)),
		}, nil
	}

	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "Data source is working",
	}, nil
}

var CallResourceHandler = backend.CallResourceHandlerFunc(func(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	switch req.Path {
	case "proxy-promql":
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
	var basePath string = config.JsonData.CustomPath
	fullURL := strings.TrimRight(basePath, "/") + incoming.Path

	var bodyReader io.Reader
	if len(incoming.Body) > 0 && string(incoming.Body) != "null" {
		bodyReader = bytes.NewReader(incoming.Body)
	}
	isMeta := strings.Contains(incoming.Path, "/api/v1/metricMetadata")
	method := http.MethodPost
	if isMeta {
		method = http.MethodGet
		bodyReader = nil
	}

	httpReq, err := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusBadGateway, Body: []byte("Failed to build request")})
	}
	httpReq.Header.Set("x-cardinalhq-api-key", config.Secrets.ApiKey)
	if isMeta {
		httpReq.Header.Set("Accept", "*/*")
	} else {
		httpReq.Header.Set("Accept", "text/event-stream")
		httpReq.Header.Set("Accept-Encoding", "identity")
		httpReq.Header.Set("Cache-Control", "no-cache")
		httpReq.Header.Set("Connection", "keep-alive")
	}
	if bodyReader != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}

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
