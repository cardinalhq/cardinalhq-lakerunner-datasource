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