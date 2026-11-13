// 两个地图页面共用筛选分组和描述字段解析。
(function () {
    const groups = [
        ['墙体', ['Co', 'Ct']],
        ['环壕水险', ['Bo', 'Bt']],
        ['低级工事', ['Po', 'Pt']],
        ['护堤', ['Go', 'Gt']],
        ['遗址区', ['Yx']],
        ['临崖山险', ['Oo']]
    ];
    const other = '其他';
    const codes = new Map(groups.flatMap(([, keys]) => keys.map(key => [key.toLowerCase(), key])));

    function getFilterKeys(description) {
        // 接入「*标签：xx，xx」时，在这里按中文逗号拆分并 trim，
        // 并将上方分组换成正式标签。返回多个键时，任意选中的键均可命中。
        const value = /(?:^|\n)\s*\*\s*线型\s*[：:]([^\r\n]*)/u.exec(description)?.[1];
        return [codes.get(value?.trim().toLowerCase()) || other];
    }

    function createNode(name, children = []) {
        return { name, children, on: true, expanded: false, el: null };
    }

    function create(container, onChange) {
        const options = new Map();
        function createOption(key) {
            const node = createNode(key);
            options.set(key, node);
            return node;
        }
        const categories = groups.map(([name, keys]) => createNode(name, keys.map(createOption)));
        categories.push(createOption(other));
        KmlFolderTree.render(container, createNode('筛选', categories), { expanded: true, onChange });
        return description => getFilterKeys(description).map(key => options.get(key) || options.get(other));
    }

    function createVisibility(layer) {
        const originalStyles = new WeakMap();
        const featureOptions = new WeakMap();
        const layerStyle = layer.getStyleFunction();

        function isVisible(feature) {
            return KmlFolderTree.isFeatureVisible(feature) &&
                (featureOptions.get(feature)?.some(option => option.on) ?? true);
        }

        function style(feature, resolution) {
            if (!isVisible(feature)) return undefined;
            const original = originalStyles.get(feature) || layerStyle;
            return original?.(feature, resolution);
        }

        function prepare(feature, options) {
            if (options) featureOptions.set(feature, options);
            // OpenLayers 优先使用要素样式，因此在这里包住 KML 原有样式。
            originalStyles.set(feature, feature.getStyleFunction());
            feature.setStyle(style);
        }

        return { prepare, isVisible };
    }

    window.LineFilter = { create, createVisibility };
})();
