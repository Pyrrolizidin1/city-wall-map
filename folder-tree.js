// KMZ/KML 文件夹目录树：解析 KML 里的 <Folder> 层级，在侧栏渲染可勾选的目录，并控制要素显示。
// map.html 与 map-satellite.html 共用。
(function () {
    function firstChildNamed(el, localName) {
        for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
            if (c.localName === localName) return c;
        }
        return null;
    }

    function folderName(el) {
        return firstChildNamed(el, 'name')?.textContent.trim() ?? '未命名';
    }

    // 接收 KML 文本或已解析的 XML 文档，返回 { doc, root, nodeById }。
    // 会给每个 Placemark 写入唯一 id（prefix + 序号），OpenLayers 读出的要素 getId() 即可对应到文件夹节点。
    function parse(input, prefix) {
        const doc = typeof input === 'string' ? new DOMParser().parseFromString(input, 'application/xml') : input;
        if (doc.getElementsByTagNameNS('*', 'parsererror').length) {
            throw new Error('KML XML 格式无效');
        }
        const nodeById = new Map();
        let seq = 0;

        function build(el, parent) {
            const node = { name: folderName(el), parent: parent, children: [], ids: [], records: [], total: 0, on: true, expanded: false, el: null };
            for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
                const ln = c.localName;
                if (ln === 'Folder' || ln === 'Document') {
                    const child = build(c, node);
                    if (child.total > 0) node.children.push(child);
                } else if (ln === 'Placemark') {
                    const id = prefix + (seq++);
                    c.setAttribute('id', id);
                    node.ids.push(id);
                    const lineType = firstChildNamed(c, 'description')?.textContent.match(/(?:^|\n)\s*\*\s*线型\s*[：:]\s*(\w+)/i)?.[1]?.toLowerCase();
                    node.records.push({ id, name: folderName(c), lineType });
                    nodeById.set(id, node);
                }
            }
            node.total = node.ids.length + node.children.reduce((s, n) => s + n.total, 0);
            return node;
        }

        const kml = doc.documentElement;
        const top = firstChildNamed(kml, 'Document') || firstChildNamed(kml, 'Folder') || kml;
        let root = build(top, null);
        // 跳过只有一层包裹的文件夹（如 Document「城址.kmz」→ Folder「城址」）
        while (root.ids.length === 0 && root.children.length === 1) {
            root = root.children[0];
            root.parent = null;
        }
        return { doc: doc, root: root, nodeById: nodeById };
    }

    // 把 OpenLayers 读出的要素挂到对应文件夹节点上
    function attachFeatures(parsed, features) {
        let matched = 0;
        features.forEach(function (f) {
            const node = parsed.nodeById.get(f.getId());
            if (node) {
                f.__folderNode = node;
                matched++;
            }
        });
        return matched;
    }

    // 每个节点记录其直属要素的选择状态。父级勾选会更新整棵子树。
    function isFeatureVisible(feature) {
        const node = feature.__folderNode;
        return !node || node.on;
    }

    function state(node) {
        let on = 0, off = 0;
        if (!node.children.length || node.ids?.length) (node.on ? on++ : off++);
        for (const c of node.children) {
            const s = state(c);
            if (s === 'mixed') return 'mixed';
            s === 'on' ? on++ : off++;
            if (on && off) return 'mixed';
        }
        return off ? (on ? 'mixed' : 'off') : 'on';
    }

    function setSubtree(node, on) {
        node.on = on;
        for (const child of node.children) setSubtree(child, on);
    }

    function refresh(node) {
        if (node.el) {
            const s = state(node);
            node.el.checkbox.checked = s === 'on';
            node.el.checkbox.indeterminate = s === 'mixed';
        }
        if (node.expanded) node.children.forEach(refresh);
    }

    function renderNode(node, tree) {
        const li = document.createElement('li');
        const row = document.createElement('div');
        row.className = 'ft-row';

        const records = tree.onFeature ? node.records : [];
        const hasChildren = node.children.length > 0 || records.length > 0;
        const caret = document.createElement('span');
        caret.className = 'ft-caret';
        if (hasChildren) {
            row.classList.add('ft-row-expandable');
            caret.setAttribute('aria-hidden', 'true');
        }

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.setAttribute('aria-label', node === tree.root ? tree.rootLabel : node.name);

        const label = document.createElement(hasChildren ? 'button' : 'span');
        const name = document.createElement('span');
        const displayName = node === tree.root ? tree.rootLabel : node.name.replace(/^\d+(?:\.\d+)*\./, '');
        name.className = 'ft-name';
        name.textContent = displayName;
        label.className = 'ft-label';
        label.title = displayName;
        label.appendChild(name);
        if (hasChildren) {
            label.type = 'button';
            label.appendChild(caret);
        }

        const count = document.createElement('span');
        count.className = 'ft-count';
        count.textContent = node.total?.toLocaleString('zh-CN') ?? '';

        row.append(cb, label, count);
        li.appendChild(row);

        let ul = null;
        function updateCaret() {
            label.setAttribute('aria-expanded', String(node.expanded));
        }

        function toggleExpand() {
            node.expanded = !node.expanded;
            updateCaret();
            if (node.expanded && !ul) {
                ul = document.createElement('ul');
                ul.className = 'ft-list';
                node.children.forEach(c => ul.appendChild(renderNode(c, tree)));
                records.forEach(record => ul.appendChild(renderRecord(record, tree)));
                li.appendChild(ul);
            }
            if (ul) ul.style.display = node.expanded ? '' : 'none';
            if (node.expanded) node.children.forEach(refresh);
        }
        if (hasChildren) {
            updateCaret();
            label.addEventListener('click', toggleExpand);
        }
        cb.addEventListener('change', function () {
            setSubtree(node, cb.checked);
            refresh(tree.root);
            tree.onChange();
        });

        node.el = { checkbox: cb, li: li, setExpanded: value => {
            if (node.expanded !== value && hasChildren) toggleExpand();
        } };
        if (node.expanded) { node.expanded = false; toggleExpand(); }
        refresh(node);
        return li;
    }

    function renderRecord(record, tree) {
        const item = document.createElement('li');
        item.className = 'ft-record';
        const name = document.createElement('button');
        name.type = 'button';
        name.className = 'ft-record-name';
        if (record.lineType) name.dataset.lineType = record.lineType;
        name.textContent = record.name;
        name.title = record.name;
        name.addEventListener('click', () => tree.onFeature(record.id));
        const locate = document.createElement('button');
        locate.type = 'button';
        locate.className = 'ft-locate icon-button';
        locate.dataset.tooltip = '定位到城址';
        locate.setAttribute('aria-label', '定位到城址：' + record.name);
        locate.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v4m0 12v4M2 12h4m12 0h4M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"/></svg>';
        locate.addEventListener('click', () => tree.onLocate(record.id));
        item.append(name, locate);
        tree.records.set(record.id, item);
        if (record.id === tree.selected) setSelected(item, true);
        return item;
    }

    function setSelected(item, selected) {
        if (!item) return;
        item.classList.toggle('selected', selected);
        if (selected) item.firstElementChild.setAttribute('aria-current', 'true');
        else item.firstElementChild.removeAttribute('aria-current');
    }

    function render(container, root, { expanded, onChange, rootLabel = root.name, onFeature, onLocate, showRoot = true }) {
        const tree = { root, rootLabel, onChange, onFeature, onLocate, records: new Map(), selected: null };
        root.expanded = !showRoot || (!!expanded && (root.children.length > 0 || Boolean(onFeature && root.records.length)));
        const ul = document.createElement('ul');
        ul.className = showRoot ? 'ft-list ft-root' : 'ft-list';
        if (showRoot) ul.appendChild(renderNode(root, tree));
        else root.children.forEach(child => ul.appendChild(renderNode(child, tree)));
        container.appendChild(ul);
        tree.setAll = function (on) {
            setSubtree(root, on);
            refresh(root);
            onChange();
        };
        tree.collapseAll = function () {
            function collapse(node) {
                node.children.forEach(collapse);
                if (node.el) node.el.setExpanded(false);
                else node.expanded = false;
            }
            if (showRoot) collapse(root);
            else root.children.forEach(collapse);
        };
        tree.select = function (id) {
            setSelected(tree.records.get(tree.selected), false);
            tree.selected = id;
            setSelected(tree.records.get(id), true);
        };
        tree.snapshot = function () {
            const off = [];
            const expanded = [];
            function collect(node, path) {
                if (!node.on) off.push(path);
                if (node.expanded) expanded.push(path);
                node.children.forEach((child, index) => collect(child, path + '/' + index));
            }
            collect(root, '');
            return { off, expanded };
        };
        tree.restore = function (saved) {
            const off = new Set(saved.off);
            const expanded = new Set(saved.expanded);
            function apply(node, path) {
                node.on = !off.has(path);
                if (node.el) node.el.setExpanded(expanded.has(path));
                else node.expanded = (!showRoot && node === root) || expanded.has(path);
                node.children.forEach((child, index) => apply(child, path + '/' + index));
            }
            apply(root, '');
            refresh(root);
            onChange();
        };
        return tree;
    }

    window.KmlFolderTree = {
        parse: parse,
        attachFeatures: attachFeatures,
        isFeatureVisible: isFeatureVisible,
        render: render
    };
})();
