package main

import (
	"github.com/cardinalhq/cardinalhq-datasource/pkg/plugin"
	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func main() {
	ds := &plugin.Datasource{}

	if err := datasource.Serve(datasource.ServeOpts{
		CheckHealthHandler:  ds,
		QueryDataHandler:    ds,
		CallResourceHandler: plugin.CallResourceHandler,
	}); err != nil {
		log.DefaultLogger.Error("Error starting plugin", "err", err.Error())
	}
}