(function () {
    const storageKey = pathname => 'city-wall-map:' + pathname;
    const byId = id => document.getElementById(id);

    function consumeState() {
        try {
            const key = storageKey(location.pathname);
            const saved = sessionStorage.getItem(key);
            sessionStorage.removeItem(key);
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    }

    function labelButton(button, label) {
        button.setAttribute('aria-label', label);
        button.dataset.tooltip = label;
    }

    function create(map, { fromWgs84, toWgs84, isFeatureVisible }) {
        const saved = consumeState();
        const view = map.getView();
        const sidebar = byId('sidebar');
        const detail = byId('map-detail');
        const detailClose = byId('detail-close');
        const mobileLayout = matchMedia('(max-width: 700px)');
        const input = byId('search-input');
        const layers = byId('layers-open');
        const results = byId('search-results');
        const searchPanel = byId('map-search-form').parentElement;
        const basemaps = byId('basemaps');
        const quickBasemap = basemaps.querySelector('.basemap-quick');
        const folderActions = byId('folder-actions');
        const actionSummary = folderActions.querySelector('summary');
        const directory = byId('directory-tab');
        const filter = byId('filter-tab');
        const trees = new Map();
        const pendingFolderActions = { ...saved.pendingFolderActions };
        let coordinate;
        let currentFeature;
        let restoreId = saved.selected;
        let searchReturn;
        let detailTrigger;

        function setSearchOpen(open) {
            results.hidden = !open;
            searchPanel.classList.toggle('results-open', open);
        }

        const selection = new ol.source.Vector();
        map.addLayer(new ol.layer.Vector({
            source: selection,
            zIndex: 45,
            style: [
                new ol.style.Style({
                    stroke: new ol.style.Stroke({ color: '#172435', width: 7 }),
                    image: new ol.style.Circle({
                        radius: 9, stroke: new ol.style.Stroke({ color: '#172435', width: 5 })
                    })
                }),
                new ol.style.Style({
                    stroke: new ol.style.Stroke({ color: '#8ef8ed', width: 3 }),
                    image: new ol.style.Circle({
                        radius: 9, stroke: new ol.style.Stroke({ color: '#8ef8ed', width: 2 })
                    })
                })
            ]
        }));
        const attribution = map.getControls().getArray().find(control => control instanceof ol.control.Attribution);
        if (attribution) map.removeControl(attribution);
        map.addControl(new ol.control.Attribution({ collapsible: false }));
        map.addControl(new ol.control.ScaleLine());

        if (saved.center?.every(Number.isFinite) && Number.isFinite(saved.zoom)) {
            view.setCenter(fromWgs84(saved.center));
            view.setZoom(saved.zoom);
        } else {
            view.fit([73, 3, 135, 54], { padding: [20, 20, 20, 20] });
        }

        function setOpen(open) {
            sidebar.hidden = !open;
            document.body.classList.toggle('sidebar-open', open);
            layers.setAttribute('aria-expanded', String(open));
            labelButton(layers, open ? '收起图层' : '打开图层');
            if (!open) folderActions.open = false;
            positionDetail();
        }

        function selectTab(tab, focus = false) {
            const showDirectory = tab === directory;
            directory.setAttribute('aria-selected', String(showDirectory));
            filter.setAttribute('aria-selected', String(!showDirectory));
            directory.tabIndex = showDirectory ? 0 : -1;
            filter.tabIndex = showDirectory ? -1 : 0;
            byId('directory-pane').hidden = !showDirectory;
            byId('line-filter').hidden = showDirectory;
            folderActions.open = false;
            if (focus) tab.focus();
        }

        function closeSidebar() {
            setOpen(false);
            layers.focus();
        }

        function setDetailOpen(open) {
            detail.hidden = !open;
            document.body.classList.toggle('detail-open', open);
            positionDetail();
        }

        function positionDetail() {
            if (detail.hidden || mobileLayout.matches || !coordinate) return;
            const pixel = map.getPixelFromCoordinate(coordinate);
            if (!pixel) return;
            const [x, y] = pixel;
            const [width, height] = map.getSize();
            const sidebarWidth = sidebar.hidden ? 0 : sidebar.offsetWidth;
            const margin = 16;
            const gap = 16;
            const offscreen = x < sidebarWidth || x > width || y < 0 || y > height;
            detail.toggleAttribute('data-offscreen', offscreen);
            if (offscreen) return;

            const left = sidebarWidth + margin;
            const right = width - margin;
            const top = 74;
            const bottom = height - 64;
            const cardWidth = detail.offsetWidth;
            const fitsRight = x + gap + cardWidth <= right;
            const fitsLeft = x - gap - cardWidth >= left;
            const stackVertically = !fitsRight && !fitsLeft;
            const above = y - gap - top;
            const below = bottom - y - gap;
            const availableHeight = stackVertically ? Math.max(above, below) : bottom - top;
            detail.style.setProperty('--detail-available-height', Math.max(136, Math.floor(availableHeight)) + 'px');

            const cardHeight = detail.offsetHeight;
            const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
            let cardX = fitsRight ? x + gap : x - gap - cardWidth;
            let cardY = y - cardHeight / 2;
            if (stackVertically) {
                cardX = x - cardWidth / 2;
                cardY = above >= below ? y - gap - cardHeight : y + gap;
            }
            detail.style.setProperty('--detail-x', Math.round(clamp(cardX, left, right - cardWidth)) + 'px');
            detail.style.setProperty('--detail-y', Math.round(clamp(cardY, top, bottom - cardHeight)) + 'px');
        }

        map.on('postrender', positionDetail);
        new ResizeObserver(positionDetail).observe(detail);

        function locate(coord, geometry, zoom = 16) {
            if (!coord) return;
            const [width, height] = map.getSize();
            const mobile = mobileLayout.matches;
            const sidebarWidth = sidebar.hidden ? 0 : sidebar.offsetWidth;
            const detailWidth = detail.hidden ? 0 : detail.offsetWidth;
            const bottomPanel = detail.hidden ? sidebar.offsetHeight : detail.offsetHeight;
            const left = mobile ? 0 : sidebarWidth;
            const right = mobile ? 0 : detailWidth;
            const bottom = mobile ? bottomPanel : 0;
            const leftPadding = left + 28;
            const rightPadding = Math.min(right + 28, width - leftPadding - 48);
            const bottomPadding = Math.min(bottom + 32, height - 72);

            if (geometry && geometry.getType() !== 'Point') {
                view.fit(geometry.getExtent(), {
                    padding: [24, rightPadding, bottomPadding, leftPadding],
                    maxZoom: 17,
                    duration: 350
                });
                return;
            }
            if (left || right || bottom) {
                view.cancelAnimations();
                view.setZoom(Math.max(view.getZoom(), zoom));
                view.centerOn(coord, [width, height], [(width + leftPadding - rightPadding) / 2, (height - bottom) / 2]);
                return;
            }
            view.animate({ center: coord, zoom: Math.max(view.getZoom(), zoom), duration: 350 });
        }

        function updateSelection() {
            selection.clear();
            const geometry = currentFeature?.getGeometry();
            if (geometry && isFeatureVisible(currentFeature)) selection.addFeature(new ol.Feature(geometry.clone()));
        }

        function setFeature(feature) {
            currentFeature = feature;
            for (const tree of trees.values()) tree.select(feature?.getId());
            updateSelection();
        }

        function syncSelection() {
            if (!currentFeature) return;
            if (!isFeatureVisible(currentFeature)) {
                dismissDetail();
                return;
            }
            if (selection.isEmpty()) updateSelection();
        }

        function closeDetail(restoreSearch = false) {
            const focused = detail.contains(document.activeElement);
            setDetailOpen(false);
            if (restoreSearch && searchReturn && input.value.trim() && results.childElementCount) {
                setSearchOpen(true);
                input.focus();
            } else if (focused) {
                const activeTab = directory.tabIndex === 0 ? directory : filter;
                const fallback = sidebar.hidden ? layers : activeTab;
                (detailTrigger?.getClientRects().length ? detailTrigger : fallback).focus();
                if (mobileLayout.matches && !restoreSearch) setSearchOpen(false);
            }
            searchReturn = false;
        }

        function dismissDetail() {
            restoreId = undefined;
            setFeature(undefined);
            if (!detail.hidden) closeDetail();
        }

        function showDetail(title, metrics, description, coord, { feature, fromSearch = false } = {}) {
            restoreId = undefined;
            coordinate = coord;
            const focused = document.activeElement;
            if (!detail.contains(focused)) detailTrigger = focused === document.body ? null : focused;
            searchReturn = fromSearch;
            if (mobileLayout.matches) setSearchOpen(false);
            setFeature(feature);
            byId('detail-title').textContent = title;
            const content = byId('detail-content');
            content.innerHTML = metrics;
            renderDescription(content, description);
            content.parentElement.scrollTop = 0;
            setDetailOpen(true);
            if (mobileLayout.matches) detailClose.focus();
        }

        layers.addEventListener('click', () => {
            if (mobileLayout.matches && !detail.hidden) closeDetail();
            if (!sidebar.hidden) {
                closeSidebar();
                return;
            }
            setOpen(true);
            byId('sidebar-close').focus();
        });
        byId('sidebar-close').addEventListener('click', closeSidebar);
        detailClose.addEventListener('click', () => closeDetail(mobileLayout.matches));
        detail.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeDetail(mobileLayout.matches);
        });
        mobileLayout.addEventListener('change', () => {
            if (detail.hidden) return;
            if (mobileLayout.matches) {
                setSearchOpen(false);
                detailClose.focus();
            } else {
                positionDetail();
            }
        });
        input.addEventListener('focus', () => {
            if (input.value.trim() && results.childElementCount) setSearchOpen(true);
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' && !results.hidden) {
                const firstResult = results.querySelector('.result-item');
                if (firstResult) {
                    event.preventDefault();
                    firstResult.focus();
                }
            }
        });
        searchPanel.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !results.hidden) {
                event.preventDefault();
                input.focus();
                setSearchOpen(false);
            }
        });
        byId('detail-locate').addEventListener('click', () => locate(coordinate, currentFeature?.getGeometry()));

        for (const tab of [directory, filter]) {
            tab.addEventListener('click', () => selectTab(tab));
            tab.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? directory : event.key === 'End' ? filter : tab === directory ? filter : directory;
                selectTab(next, true);
            });
        }
        function applyFolderAction(action, value) {
            const activeTrees = filter.tabIndex === 0 ? ['line'] : ['main', 'extra'];
            for (const key of activeTrees) {
                const tree = trees.get(key);
                if (tree) tree[action](value);
                else (pendingFolderActions[key] ||= {})[action] = value;
            }
        }

        byId('ft-all').addEventListener('click', () => applyFolderAction('setAll', true));
        byId('ft-none').addEventListener('click', () => applyFolderAction('setAll', false));
        byId('ft-collapse').addEventListener('click', () => applyFolderAction('collapseAll', true));
        folderActions.addEventListener('click', event => {
            if (!event.target.closest('button')) return;
            folderActions.open = false;
            actionSummary.focus();
        });
        sidebar.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            if (folderActions.open) {
                folderActions.open = false;
                actionSummary.focus();
                return;
            }
            closeSidebar();
        });

        selectTab(saved.filterTab ? filter : directory);
        setOpen(Boolean(saved.open));
        document.addEventListener('click', event => {
            if (!folderActions.contains(event.target)) folderActions.open = false;
            if (!searchPanel.contains(event.target) && !detail.contains(event.target)) {
                setSearchOpen(false);
            }
        });

        function save(destination) {
            const filters = { ...saved.filters };
            for (const [key, tree] of trees) filters[key] = tree.snapshot();
            try {
                sessionStorage.setItem(storageKey(destination), JSON.stringify({
                    center: toWgs84(view.getCenter()),
                    zoom: view.getZoom(),
                    open: !sidebar.hidden,
                    filterTab: filter.tabIndex === 0,
                    selected: currentFeature?.getId() ?? restoreId,
                    detail: !detail.hidden || Boolean(restoreId && saved.detail),
                    filters,
                    pendingFolderActions
                }));
            } catch {
                // The links remain usable when storage is unavailable.
            }
        }

        function dismissBasemaps() {
            quickBasemap.focus();
            basemaps.dataset.dismissed = '';
        }

        basemaps.addEventListener('pointerenter', () => { delete basemaps.dataset.dismissed; });
        basemaps.addEventListener('focusin', event => {
            if (!basemaps.contains(event.relatedTarget)) delete basemaps.dataset.dismissed;
        });
        basemaps.addEventListener('click', event => {
            const link = event.target.closest('a');
            if (!link) return;
            if (link.hasAttribute('aria-current')) {
                event.preventDefault();
                dismissBasemaps();
                return;
            }
            save(new URL(link.href).pathname);
        });
        basemaps.addEventListener('keydown', event => {
            if (event.key === 'Escape') dismissBasemaps();
        });
        document.querySelector('.map-home-link').addEventListener('click', () => save(location.pathname));
        window.addEventListener('pageshow', event => {
            if (event.persisted) consumeState();
        });

        return {
            locate, showDetail, labelButton, setSearchOpen,
            selectedFeature: () => currentFeature,
            syncSelection,
            handleMapBackgroundClick() {
                if (mobileLayout.matches) dismissDetail();
            },
            registerTree(key, tree) {
                trees.set(key, tree);
                const state = saved.filters?.[key];
                if (state) tree.restore(state);
                const pending = pendingFolderActions[key];
                if (pending) {
                    if (pending.setAll !== undefined) tree.setAll(pending.setAll);
                    if (pending.collapseAll) tree.collapseAll();
                    delete pendingFolderActions[key];
                }
                tree.select(currentFeature?.getId());
            },
            restoreDetail(batch, showFeature) {
                if (!restoreId) return;
                const feature = batch.find(item => item.getId() === restoreId);
                if (!feature) return;
                restoreId = undefined;
                const geometry = feature.getGeometry();
                if (!geometry) return;
                setFeature(feature);
                if (saved.detail) showFeature(feature);
            }
        };
    }

    function escapeHTML(value) {
        const span = document.createElement('span');
        span.textContent = value;
        return span.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderDescription(target, description) {
        const normalized = String(description).replace(/<br\s*\/?\s*>/gi, '\n').trim();
        const groups = normalized.split(/^\s*\*\s*([^：:\n]+)[：:]\s*/m);
        if (groups[0] || groups.length === 1) {
            const intro = document.createElement('p');
            intro.className = 'detail-description';
            intro.textContent = groups[0] || '（无描述信息）';
            target.append(intro);
        }
        if (groups.length === 1) return;

        const list = document.createElement('dl');
        list.className = 'detail-fields';
        for (let i = 1; i < groups.length; i += 2) {
            const heading = document.createElement('dt');
            const value = document.createElement('dd');
            heading.textContent = groups[i];
            value.textContent = groups[i + 1].trim();
            list.append(heading, value);
        }
        target.append(list);
    }

    window.MapUI = { create, escapeHTML };
})();
