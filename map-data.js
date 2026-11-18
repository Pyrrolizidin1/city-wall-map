// 两种底图共用 KMZ 读取、目录挂接和城址索引。
(function () {
    const batchSize = 2000;
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    function showFolderStatus(container, message) {
        const status = document.createElement('div');
        status.className = 'ft-empty';
        status.textContent = message;
        container.replaceChildren(status);
    }

    async function readKml(buffer) {
        if (new Uint8Array(buffer)[0] !== 0x50) return new TextDecoder().decode(buffer);
        const zip = await JSZip.loadAsync(buffer);
        let kmlFile;
        zip.forEach((path, file) => {
            if (path.toLowerCase().endsWith('.kml')) kmlFile = file;
        });
        if (!kmlFile) throw new Error('KMZ 中没有 KML 文件');
        return kmlFile.async('text');
    }

    function load({ main, extra, mapUI, getLineOptions, featureSearchIndex, featureRecords, transformCoordinates, showFeature, locateFeature, redrawFeatures }) {
        const status = document.getElementById('status');
        const progressBar = document.getElementById('progress-bar');
        const progressFill = document.getElementById('progress-fill');
        const progressTip = document.getElementById('progress-tip');

        function setProgress(percent) {
            progressFill.style.width = percent + '%';
            progressFill.textContent = Math.round(percent) + '%';
        }

        function hideProgress() {
            progressBar.style.display = 'none';
            progressTip.style.display = 'none';
        }

        async function addFeatures(kml, { layer, visibility, isExtra, container }) {
            const doc = new DOMParser().parseFromString(kml, 'application/xml');
            if (!isExtra) await delay(0);
            // 目录解析会为 Placemark 写入稳定 ID，OpenLayers 用同一份文档读取要素。
            const parsed = KmlFolderTree.parse(doc, isExtra ? 'e' : 'm');
            if (!isExtra) {
                status.textContent = '正在读取地图要素…';
                await delay(0);
            }
            const format = new ol.format.KML({ extractStyles: true });
            const features = format.readFeatures(parsed.doc, { featureProjection: 'EPSG:4326' });
            if (!features.length) {
                showFolderStatus(container, '没有可显示的要素');
                return 0;
            }

            const source = layer.getSource();
            const matched = KmlFolderTree.attachFeatures(parsed, features);
            if (matched === features.length) {
                container.replaceChildren();
                const tree = KmlFolderTree.render(container, parsed.root, {
                    expanded: !isExtra,
                    rootLabel: isExtra ? '轮廓未定点位' : '城址线型数据',
                    onFeature: id => showFeature(source.getFeatureById(id), { locate: true }),
                    onLocate: id => locateFeature(source.getFeatureById(id)),
                    onChange: () => redrawFeatures(layer)
                });
                mapUI.registerTree(isExtra ? 'extra' : 'main', tree);
            } else {
                console.warn(`目录匹配不完整（${matched}/${features.length}），已跳过目录树`);
                showFolderStatus(container, '目录解析失败，已显示全部要素');
            }

            await delay(0);
            for (let start = 0; start < features.length; start += batchSize) {
                const end = Math.min(start + batchSize, features.length);
                const batch = features.slice(start, end);
                for (const feature of batch) {
                    if (transformCoordinates) {
                        const geometry = feature.getGeometry();
                        if (geometry) geometry.setCoordinates(transformCoordinates(geometry.getCoordinates()));
                    }

                    const name = feature.get('name') || feature.get('Name') || '未命名';
                    const desc = feature.get('description') || feature.get('Description') || '';
                    const searchText = (name + ' ' + desc).toLowerCase();
                    visibility.prepare(feature, isExtra ? null : getLineOptions(desc));

                    const record = { index: featureSearchIndex.length, feature, name, desc, searchText, layer };
                    featureSearchIndex.push(record);
                    featureRecords.set(feature, record);

                    if (isExtra) {
                        for (const property of ['name', 'Name', 'description', 'Description']) feature.unset(property);
                    }
                }

                source.addFeatures(batch);
                mapUI.restoreDetail(batch, showFeature);

                if (!isExtra) {
                    setProgress(Math.round(55 + end / features.length * 45));
                    status.textContent = `已加载城址 ${end} / ${features.length}`;
                    progressTip.style.display = 'none';
                }
                if (end < features.length) await delay(0);
            }
            return features.length;
        }

        async function loadLayer(url, config) {
            const { isExtra, container } = config;
            let progressTimer;
            try {
                if (!isExtra) {
                    progressBar.style.display = 'block';
                    progressTip.style.display = 'flex';
                    progressTip.textContent = '初次加载速度可能较慢，请耐心等待';
                    status.textContent = '正在连接服务器…';
                    let percent = 5;
                    setProgress(percent);
                    progressTimer = setInterval(() => {
                        if (percent < 50) setProgress(percent += .5);
                    }, 200);
                }

                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                if (!isExtra) status.textContent = '正在下载城址数据…';
                const buffer = await response.arrayBuffer();
                if (!isExtra) {
                    clearInterval(progressTimer);
                    setProgress(55);
                    status.textContent = '正在解压数据…';
                }

                const kml = await readKml(buffer);
                if (!isExtra) {
                    status.textContent = '正在解析…';
                    await delay(0);
                }
                const total = await addFeatures(kml, config);

                if (!isExtra) {
                    hideProgress();
                    status.textContent = total
                        ? `已加载 ${total.toLocaleString('zh-CN')} 个城址要素`
                        : '城址文件中没有可显示的要素';
                    if (total) setTimeout(() => {
                        status.style.opacity = '0';
                        setTimeout(() => { status.style.display = 'none'; }, 500);
                    }, 5000);
                }
            } catch (error) {
                if (isExtra) {
                    console.warn(`轮廓未定数据加载失败: ${error.message}`);
                    showFolderStatus(container, '轮廓未定目录加载失败');
                } else {
                    status.textContent = `城址加载失败: ${error.message}`;
                    hideProgress();
                    showFolderStatus(container, '城址目录加载失败');
                }
            } finally {
                clearInterval(progressTimer);
            }
        }

        return Promise.all([
            loadLayer('城址.kmz', {
                ...main, isExtra: false, container: document.getElementById('folder-tree-main')
            }),
            loadLayer('轮廓未定.kmz', {
                ...extra, isExtra: true, container: document.getElementById('folder-tree-extra')
            })
        ]);
    }

    window.MapData = { load };
})();
