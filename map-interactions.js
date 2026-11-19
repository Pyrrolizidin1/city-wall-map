// 两种底图共用要素选中、定位和鼠标悬停。
(function () {
    const hitTolerance = 15;

    function getFeatureMetrics(geometry, toWgs84) {
        if (!geometry) return '';
        function formatLength(geom) {
            const length = ol.sphere.getLength(geom, {projection: 'EPSG:4326'});
            return length > 1000 ? (length / 1000).toFixed(2) + ' 公里' : length.toFixed(2) + ' 米';
        }
        function formatArea(geom) {
            const area = ol.sphere.getArea(geom, {projection: 'EPSG:4326'});
            return area > 100000 ? (area / 1000000).toFixed(2) + ' 平方公里' : area.toFixed(2) + ' 平方米';
        }
        let result = '';
        let centerCoord = null;

        if (geometry instanceof ol.geom.Polygon) {
            result = `周长：${formatLength(geometry.getLinearRing(0))} &nbsp;|&nbsp; 面积：${formatArea(geometry)}`;
            centerCoord = geometry.getInteriorPoint().getCoordinates();
        } else if (geometry instanceof ol.geom.LineString) {
            const coords = geometry.getCoordinates();
            const first = coords[0];
            const last = coords[coords.length - 1];
            const isClosed = Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6;
            if (isClosed) {
                const polyGeom = new ol.geom.Polygon([coords]);
                result = `周长：${formatLength(geometry)} &nbsp;|&nbsp; 面积：${formatArea(polyGeom)}`;
            } else {
                result = `长度：${formatLength(geometry)}`;
            }
            centerCoord = geometry.getCoordinateAt(0.5);
        }

        if (result) {
            let coordText = '';
            if (centerCoord) {
                const wgsCoord = toWgs84(centerCoord);
                coordText = `<br>中心点：${wgsCoord[0].toFixed(5)}, ${wgsCoord[1].toFixed(5)}`;
            }
            return `<div style="font-size:12px; color:#666; margin-bottom:8px; padding-bottom:6px; border-bottom:1px dashed #eee;">${result}${coordText}</div>`;
        }
        return '';
    }

    function create(map, { layers, featureRecords, fromWgs84, toWgs84, isMeasuring }) {
        const visibilityByLayer = new Map(layers.map(({ layer, visibility }) => [layer, visibility]));
        function isVisible(feature, layer) {
            return visibilityByLayer.has(layer) && layer.getVisible() && visibilityByLayer.get(layer).isVisible(feature);
        }

        const ui = MapUI.create(map, {
            fromWgs84,
            toWgs84,
            isFeatureVisible: feature => isVisible(feature, featureRecords.get(feature)?.layer)
        });

        function showFeature(feature, { coordinate, locate = false, fromSearch = false } = {}) {
            const geometry = feature?.getGeometry();
            if (!geometry) return false;
            const record = featureRecords.get(feature);
            const name = record?.name ?? (feature.get('name') || feature.get('Name') || '（无标题）');
            const description = record?.desc ?? (feature.get('description') || feature.get('Description') || '');
            const anchor = coordinate ?? ol.extent.getCenter(geometry.getExtent());

            ui.showDetail(name, getFeatureMetrics(geometry, toWgs84), description, anchor, { feature, fromSearch });
            if (locate) ui.locate(anchor, geometry);
            return true;
        }

        function locateFeature(feature) {
            const geometry = feature?.getGeometry();
            if (geometry) ui.locate(ol.extent.getCenter(geometry.getExtent()), geometry);
        }

        const hoverSource = new ol.source.Vector();
        map.addLayer(new ol.layer.Vector({
            source: hoverSource,
            style: new ol.style.Style({
                stroke: new ol.style.Stroke({ color: '#fff', width: 4, lineJoin: 'round', lineCap: 'round' }),
                image: new ol.style.Circle({
                    radius: 10,
                    fill: new ol.style.Fill({ color: 'rgba(255, 255, 255, 0.4)' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 3 })
                })
            }),
            zIndex: 50
        }));

        const target = map.getTargetElement();
        let hoveredFeature;

        function redrawFeatures(layer) {
            if (hoveredFeature) {
                hoveredFeature = undefined;
                hoverSource.clear();
                target.style.cursor = '';
            }
            ui.syncSelection();
            layer.changed();
        }

        function featureAtPixel(pixel) {
            return map.forEachFeatureAtPixel(pixel, (feature, layer) => {
                if (isVisible(feature, layer)) return feature;
            }, { hitTolerance });
        }

        map.on('click', event => {
            if (isMeasuring()) return;
            const feature = featureAtPixel(event.pixel);
            if (!showFeature(feature, { coordinate: event.coordinate })) ui.handleMapBackgroundClick();
        });

        map.on('pointermove', event => {
            if (isMeasuring()) {
                target.style.cursor = 'crosshair';
                return;
            }
            if (event.dragging) return;

            const feature = featureAtPixel(event.pixel);
            if (feature === hoveredFeature) return;
            hoveredFeature = feature;
            hoverSource.clear();
            target.style.cursor = feature ? 'pointer' : '';

            const geometry = feature?.getGeometry();
            if (!geometry) return;
            const highlight = new ol.Feature(geometry.clone());
            if (geometry.getType() === 'Point') {
                const styles = feature.getStyleFunction()?.(feature, map.getView().getResolution());
                const style = Array.isArray(styles) ? styles[0] : styles;
                const image = style?.getImage()?.clone() ?? new ol.style.Circle({
                    radius: 6, fill: new ol.style.Fill({ color: '#fff' })
                });
                highlight.setStyle(new ol.style.Style({ image }));
            }
            hoverSource.addFeature(highlight);
        });

        return { ui, showFeature, locateFeature, redrawFeatures };
    }

    window.MapInteractions = { create };
})();
