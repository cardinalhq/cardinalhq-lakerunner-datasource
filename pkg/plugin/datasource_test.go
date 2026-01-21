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
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestQueryData(t *testing.T) {
	ds := Datasource{}

	resp, err := ds.QueryData(
		context.Background(),
		&backend.QueryDataRequest{
			Queries: []backend.DataQuery{
				{RefID: "A"},
			},
		},
	)
	if err != nil {
		t.Error(err)
	}

	if len(resp.Responses) != 1 {
		t.Fatal("QueryData must return a response")
	}
}

func TestMetricsQueryWithSSE(t *testing.T) {
	// Mock SSE server that returns the actual format from CardinalHQ API
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request format
		if r.URL.Path != "/api/v1/metrics/query" {
			t.Errorf("Expected path /api/v1/metrics/query, got %s", r.URL.Path)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("Expected Content-Type application/json, got %s", r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Errorf("Expected Accept text/event-stream, got %s", r.Header.Get("Accept"))
		}

		// Verify request body has PromQL format
		var reqBody struct {
			S string `json:"s"`
			E string `json:"e"`
			Q string `json:"q"`
		}
		if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
			t.Errorf("Failed to decode request body: %v", err)
		}
		if reqBody.Q == "" {
			t.Error("Expected non-empty PromQL query")
		}

		// Send SSE response in actual CardinalHQ format
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)

		// Write result messages (actual format from API)
		baseTime := time.Now().Add(-1 * time.Hour).UnixMilli()
		results := []struct {
			ts    int64
			value float64
			label string
		}{
			{baseTime, 10.5, "series1"},
			{baseTime + 10000, 20.3, "series1"},
			{baseTime + 20000, 15.7, "series1"},
			{baseTime, 5.2, "series2"},
			{baseTime + 10000, 8.1, "series2"},
		}

		for _, r := range results {
			msg := fmt.Sprintf(`data: {"type":"result","data":{"timestamp":%d,"value":%f,"label":"%s"}}`, r.ts, r.value, r.label)
			fmt.Fprintln(w, msg)
			fmt.Fprintln(w)
		}

		// Write done message (actual format from API)
		fmt.Fprintln(w, `data: {"type":"done","data":{"status":"ok"}}`)
		fmt.Fprintln(w)
	}))
	defer server.Close()

	ds := Datasource{}

	// Build query request
	queryJSON := fmt.Sprintf(`{
		"mode": "metrics",
		"metricName": "test_metric",
		"aggregation": "avg",
		"groupBy": ["env"],
		"filters": []
	}`)

	resp, err := ds.QueryData(
		context.Background(),
		&backend.QueryDataRequest{
			PluginContext: backend.PluginContext{
				DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{
					JSONData: []byte(fmt.Sprintf(`{"customPath": "%s"}`, server.URL)),
					DecryptedSecureJSONData: map[string]string{
						"apiKey": "test-api-key",
					},
				},
			},
			Queries: []backend.DataQuery{
				{
					RefID:         "A",
					JSON:          []byte(queryJSON),
					TimeRange:     backend.TimeRange{From: time.Now().Add(-1 * time.Hour), To: time.Now()},
					MaxDataPoints: 100,
				},
			},
		},
	)

	if err != nil {
		t.Fatalf("QueryData failed: %v", err)
	}

	if len(resp.Responses) != 1 {
		t.Fatalf("Expected 1 response, got %d", len(resp.Responses))
	}

	result := resp.Responses["A"]
	if result.Error != nil {
		t.Fatalf("Query returned error: %v", result.Error)
	}

	// Should have 2 frames (series1 and series2)
	if len(result.Frames) != 2 {
		t.Fatalf("Expected 2 frames, got %d", len(result.Frames))
	}

	// Verify frame data
	for _, frame := range result.Frames {
		if frame.Fields[0].Name != "Time" {
			t.Errorf("Expected first field to be Time, got %s", frame.Fields[0].Name)
		}
		if frame.Fields[1].Name != "Value" {
			t.Errorf("Expected second field to be Value, got %s", frame.Fields[1].Name)
		}
	}
}

func TestMetricsQueryEmptyResult(t *testing.T) {
	// Mock SSE server that returns no data (just done message)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)

		// Only send done message, no data
		fmt.Fprintln(w, `data: {"type":"done","data":{"status":"ok"}}`)
		fmt.Fprintln(w)
	}))
	defer server.Close()

	ds := Datasource{}

	queryJSON := `{
		"mode": "metrics",
		"metricName": "nonexistent_metric",
		"aggregation": "avg",
		"groupBy": [],
		"filters": []
	}`

	resp, err := ds.QueryData(
		context.Background(),
		&backend.QueryDataRequest{
			PluginContext: backend.PluginContext{
				DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{
					JSONData: []byte(fmt.Sprintf(`{"customPath": "%s"}`, server.URL)),
					DecryptedSecureJSONData: map[string]string{
						"apiKey": "test-api-key",
					},
				},
			},
			Queries: []backend.DataQuery{
				{
					RefID:         "A",
					JSON:          []byte(queryJSON),
					TimeRange:     backend.TimeRange{From: time.Now().Add(-1 * time.Hour), To: time.Now()},
					MaxDataPoints: 100,
				},
			},
		},
	)

	if err != nil {
		t.Fatalf("QueryData failed: %v", err)
	}

	result := resp.Responses["A"]
	if result.Error != nil {
		t.Fatalf("Query returned error: %v (empty result should not error)", result.Error)
	}

	// Empty result should return 0 frames, not an error
	if len(result.Frames) != 0 {
		t.Errorf("Expected 0 frames for empty result, got %d", len(result.Frames))
	}
}

func TestMetricsQueryWithFilters(t *testing.T) {
	var capturedQuery string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody struct {
			Q string `json:"q"`
		}
		json.NewDecoder(r.Body).Decode(&reqBody)
		capturedQuery = reqBody.Q

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, `data: {"type":"done","data":{"status":"ok"}}`)
		fmt.Fprintln(w)
	}))
	defer server.Close()

	ds := Datasource{}

	queryJSON := `{
		"mode": "metrics",
		"metricName": "http_requests_total",
		"aggregation": "sum",
		"groupBy": ["method", "status"],
		"filters": [
			{"tag": "env", "op": "=", "value": ["production"]},
			{"tag": "region", "op": "in", "value": ["us-east", "us-west"]}
		]
	}`

	ds.QueryData(
		context.Background(),
		&backend.QueryDataRequest{
			PluginContext: backend.PluginContext{
				DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{
					JSONData: []byte(fmt.Sprintf(`{"customPath": "%s"}`, server.URL)),
					DecryptedSecureJSONData: map[string]string{
						"apiKey": "test-api-key",
					},
				},
			},
			Queries: []backend.DataQuery{
				{
					RefID:         "A",
					JSON:          []byte(queryJSON),
					TimeRange:     backend.TimeRange{From: time.Now().Add(-1 * time.Hour), To: time.Now()},
					MaxDataPoints: 100,
				},
			},
		},
	)

	// Verify the generated PromQL contains expected parts
	if capturedQuery == "" {
		t.Fatal("No query was captured")
	}

	expectedParts := []string{
		"http_requests_total",
		"sum",
		"method",
		"status",
		`env="production"`,
		`region=~"us-east|us-west"`,
	}

	for _, p := range expectedParts {
		if !contains(capturedQuery, p) {
			t.Errorf("Expected PromQL to contain '%s', got: %s", p, capturedQuery)
		}
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func TestLogQueryWithSSE(t *testing.T) {
	// Mock SSE server that returns the actual format from CardinalHQ API for logs
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request format
		if r.URL.Path != "/api/v1/logs/query" {
			t.Errorf("Expected path /api/v1/logs/query, got %s", r.URL.Path)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("Expected Content-Type application/json, got %s", r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Errorf("Expected Accept text/event-stream, got %s", r.Header.Get("Accept"))
		}

		// Verify request body has LogQL format
		var reqBody struct {
			S string `json:"s"`
			E string `json:"e"`
			Q string `json:"q"`
		}
		if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
			t.Errorf("Failed to decode request body: %v", err)
		}
		if reqBody.Q == "" {
			t.Error("Expected non-empty LogQL query")
		}

		// Send SSE response in actual CardinalHQ format
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)

		// Write result messages (aggregated log data)
		baseTime := time.Now().Add(-1 * time.Hour).UnixMilli()
		results := []struct {
			ts    int64
			value float64
			label string
		}{
			{baseTime, 100, "level=error"},
			{baseTime + 60000, 150, "level=error"},
			{baseTime + 120000, 75, "level=error"},
			{baseTime, 500, "level=info"},
			{baseTime + 60000, 450, "level=info"},
		}

		for _, r := range results {
			msg := fmt.Sprintf(`data: {"type":"result","data":{"timestamp":%d,"value":%f,"label":"%s"}}`, r.ts, r.value, r.label)
			fmt.Fprintln(w, msg)
			fmt.Fprintln(w)
		}

		// Write done message
		fmt.Fprintln(w, `data: {"type":"done","data":{"status":"ok"}}`)
		fmt.Fprintln(w)
	}))
	defer server.Close()

	ds := Datasource{}

	// Build log query request for alerting
	queryJSON := fmt.Sprintf(`{
		"mode": "logs",
		"queryText": "alert",
		"filters": [
			{"tag": "log_level", "op": "in", "value": ["error", "warn"]}
		],
		"logqlAggregation": "sum",
		"valueAs": "count_over_time",
		"groupBy": ["log_level"]
	}`)

	resp, err := ds.QueryData(
		context.Background(),
		&backend.QueryDataRequest{
			PluginContext: backend.PluginContext{
				DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{
					JSONData: []byte(fmt.Sprintf(`{"customPath": "%s"}`, server.URL)),
					DecryptedSecureJSONData: map[string]string{
						"apiKey": "test-api-key",
					},
				},
			},
			Queries: []backend.DataQuery{
				{
					RefID:         "A",
					JSON:          []byte(queryJSON),
					TimeRange:     backend.TimeRange{From: time.Now().Add(-1 * time.Hour), To: time.Now()},
					MaxDataPoints: 100,
				},
			},
		},
	)

	if err != nil {
		t.Fatalf("QueryData failed: %v", err)
	}

	if len(resp.Responses) != 1 {
		t.Fatalf("Expected 1 response, got %d", len(resp.Responses))
	}

	result := resp.Responses["A"]
	if result.Error != nil {
		t.Fatalf("Query returned error: %v", result.Error)
	}

	// Should have 2 frames (level=error and level=info)
	if len(result.Frames) != 2 {
		t.Fatalf("Expected 2 frames, got %d", len(result.Frames))
	}

	// Verify frame data
	for _, frame := range result.Frames {
		if frame.Fields[0].Name != "Time" {
			t.Errorf("Expected first field to be Time, got %s", frame.Fields[0].Name)
		}
		if frame.Fields[1].Name != "Value" {
			t.Errorf("Expected second field to be Value, got %s", frame.Fields[1].Name)
		}
	}
}

func TestLogQueryEmptyResult(t *testing.T) {
	// Mock SSE server that returns no data (just done message)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)

		// Only send done message, no data
		fmt.Fprintln(w, `data: {"type":"done","data":{"status":"ok"}}`)
		fmt.Fprintln(w)
	}))
	defer server.Close()

	ds := Datasource{}

	queryJSON := `{
		"mode": "logs",
		"queryText": "alert",
		"filters": [
			{"tag": "log_level", "op": "=", "value": ["critical"]}
		],
		"logqlAggregation": "sum",
		"valueAs": "count_over_time",
		"groupBy": []
	}`

	resp, err := ds.QueryData(
		context.Background(),
		&backend.QueryDataRequest{
			PluginContext: backend.PluginContext{
				DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{
					JSONData: []byte(fmt.Sprintf(`{"customPath": "%s"}`, server.URL)),
					DecryptedSecureJSONData: map[string]string{
						"apiKey": "test-api-key",
					},
				},
			},
			Queries: []backend.DataQuery{
				{
					RefID:         "A",
					JSON:          []byte(queryJSON),
					TimeRange:     backend.TimeRange{From: time.Now().Add(-1 * time.Hour), To: time.Now()},
					MaxDataPoints: 100,
				},
			},
		},
	)

	if err != nil {
		t.Fatalf("QueryData failed: %v", err)
	}

	result := resp.Responses["A"]
	if result.Error != nil {
		t.Fatalf("Query returned error: %v (empty result should not error)", result.Error)
	}

	// Empty result should return 0 frames, not an error
	if len(result.Frames) != 0 {
		t.Errorf("Expected 0 frames for empty result, got %d", len(result.Frames))
	}
}

func TestBuildLogQL(t *testing.T) {
	tests := []struct {
		name     string
		query    queryModel
		window   string
		expected string
	}{
		{
			name: "count_over_time with sum aggregation",
			query: queryModel{
				Filters: []uiFilter{
					{Tag: "log_level", Op: "=", Value: []string{"error"}},
				},
				LogqlAggregation: "sum",
				ValueAs:          "count_over_time",
			},
			window:   "5m",
			expected: `sum(count_over_time({log_level="error"}[5m]))`,
		},
		{
			name: "filter with group by",
			query: queryModel{
				Filters: []uiFilter{
					{Tag: "service", Op: "=", Value: []string{"api"}},
				},
				LogqlAggregation: "sum",
				ValueAs:          "count_over_time",
				GroupBy:          []string{"log_level"},
			},
			window:   "5m",
			expected: `sum by (log_level)(count_over_time({service="api"}[5m]))`,
		},
		{
			name: "multiple filters",
			query: queryModel{
				Filters: []uiFilter{
					{Tag: "env", Op: "=", Value: []string{"prod"}},
					{Tag: "log_level", Op: "in", Value: []string{"error", "warn"}},
				},
				LogqlAggregation: "sum",
				ValueAs:          "count_over_time",
			},
			window:   "5m",
			expected: `sum(count_over_time({env="prod", log_level=~"^(?:error|warn)$"}[5m]))`,
		},
		{
			name: "line filter (message contains)",
			query: queryModel{
				Filters: []uiFilter{
					{Tag: "log_level", Op: "=", Value: []string{"error"}},
					{Tag: "log_message", Op: "contains", Value: []string{"timeout"}},
				},
				LogqlAggregation: "sum",
				ValueAs:          "count_over_time",
			},
			window:   "5m",
			expected: `sum(count_over_time({log_level="error"} |= "timeout"[5m]))`,
		},
		{
			name: "rate aggregation",
			query: queryModel{
				Filters: []uiFilter{
					{Tag: "service", Op: "=", Value: []string{"web"}},
				},
				LogqlAggregation: "sum",
				ValueAs:          "rates_per_second",
			},
			window:   "5m",
			expected: `sum(rate({service="web"}[5m]))`,
		},
		{
			name: "no aggregation with count_over_time",
			query: queryModel{
				Filters: []uiFilter{
					{Tag: "app", Op: "=", Value: []string{"myapp"}},
				},
				ValueAs: "count_over_time",
				GroupBy: []string{"log_level"},
			},
			window:   "5m",
			expected: `sum by (log_level)(count_over_time({app="myapp"}[5m]))`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := buildLogQL(tt.query, tt.window)
			if result != tt.expected {
				t.Errorf("buildLogQL() = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestBuildPromQL(t *testing.T) {
	tests := []struct {
		name     string
		query    queryModel
		expected string
	}{
		{
			name: "simple metric with aggregation",
			query: queryModel{
				MetricName:  "cpu_usage",
				Aggregation: "avg",
			},
			expected: "avg(cpu_usage)",
		},
		{
			name: "metric with group by",
			query: queryModel{
				MetricName:  "http_requests",
				Aggregation: "sum",
				GroupBy:     []string{"method", "status"},
			},
			expected: "sum by (method,status)(http_requests)",
		},
		{
			name: "metric with equality filter",
			query: queryModel{
				MetricName:  "memory_usage",
				Aggregation: "max",
				Filters: []uiFilter{
					{Tag: "env", Op: "=", Value: []string{"prod"}},
				},
			},
			expected: `max(memory_usage{env="prod"})`,
		},
		{
			name: "metric with regex filter (in operator)",
			query: queryModel{
				MetricName:  "requests",
				Aggregation: "sum",
				Filters: []uiFilter{
					{Tag: "region", Op: "in", Value: []string{"us-east", "us-west"}},
				},
			},
			expected: `sum(requests{region=~"us-east|us-west"})`,
		},
		{
			name: "metric with not equals filter",
			query: queryModel{
				MetricName:  "errors",
				Aggregation: "count",
				Filters: []uiFilter{
					{Tag: "level", Op: "!=", Value: []string{"debug"}},
				},
			},
			expected: `count(errors{level!="debug"})`,
		},
		{
			name: "metric with rate transformation",
			query: queryModel{
				MetricName:  "counter",
				Aggregation: "sum",
				ValueAs:     "rates_per_second",
			},
			expected: "sum(rate(counter[5m]))",
		},
		{
			name: "metric without aggregation",
			query: queryModel{
				MetricName: "gauge_value",
			},
			expected: "gauge_value",
		},
		{
			name: "metric with dotted label name",
			query: queryModel{
				MetricName:  "metric",
				Aggregation: "avg",
				Filters: []uiFilter{
					{Tag: "k8s.namespace", Op: "=", Value: []string{"default"}},
				},
			},
			expected: `avg(metric{"k8s.namespace"="default"})`,
		},
		{
			name: "metric with dotted metric name uses __name__",
			query: queryModel{
				MetricName:  "k8s.cpu.total",
				Aggregation: "avg",
			},
			expected: `avg({__name__="k8s.cpu.total"})`,
		},
		{
			name: "metric with dotted metric name and filters uses __name__",
			query: queryModel{
				MetricName:  "k8s.memory.usage",
				Aggregation: "sum",
				Filters: []uiFilter{
					{Tag: "namespace", Op: "=", Value: []string{"default"}},
				},
			},
			expected: `sum({__name__="k8s.memory.usage", namespace="default"})`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := buildPromQL(tt.query)
			if result != tt.expected {
				t.Errorf("buildPromQL() = %q, want %q", result, tt.expected)
			}
		})
	}
}
