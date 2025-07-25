#!/bin/sh

# Exit immediately if a command exits with a non-zero status
set -e

rm -rf dist
rm -rf cardinalhq-lakerunner-datasource
rm -rf cardinalhq-lakerunner-datasource*.zip

npm run build
mage

npx @grafana/sign-plugin@latest --rootUrls=http://localhost:3000,https://grafana.cardinalhq.io

mv dist cardinalhq-lakerunner-datasource
zip -r cardinalhq-lakerunner-datasource.zip cardinalhq-lakerunner-datasource

rm -rf cardinalhq-lakerunner-datasource
