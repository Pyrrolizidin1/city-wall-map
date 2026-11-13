// KMZ/KML 文件夹目录树：解析 KML 里的 <Folder> 层级，在侧栏渲染可勾选的目录，并控制要素显示。
// map.html 与 map-satellite.html 共用。
(function () {
    function childElements(el, localName) {
        const out = [];
        for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
            if (c.localName === localName) out.push(c);
        }
        return out;
    }

    function folderName(el) {
        const n = childElements(el, 'name')[0];
        return n ? n.textContent.trim() : '未命名';
    }

    // 解析 KML 文本，返回 { doc, root, nodeById }。
    // 会给每个 Placemark 写入唯一 id（prefix + 序号），OpenLayers 读出的要素 getId() 即可对应到文件夹节点。
    function parse(kmlText, prefix) {
        const doc = new DOMParser().parseFromString(kmlText, 'application/xml');
        if (doc.getElementsByTagNameNS('*', 'parsererror').length) {
            throw new Error('KML XML 格式无效');
        }
        const nodeById = new Map();
        let seq = 0;

        function build(el, parent) {
            const node = { name: folderName(el), parent: parent, children: [], features: [], ids: [], total: 0, on: true, expanded: false, el: null };
            for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
                const ln = c.localName;
                if (ln === 'Folder' || ln === 'Document') {
                    const child = build(c, node);
                    if (child.total > 0) node.children.push(child);
                } else if (ln === 'Placemark') {
                    const id = prefix + (seq++);
                    c.setAttribute('id', id);
                    node.ids.push(id);
                    nodeById.set(id, node);
                }
            }
            node.total = node.ids.length + node.children.reduce((s, n) => s + n.total, 0);
            return node;
        }

        const kml = doc.documentElement;
        const top = childElements(kml, 'Document')[0] || childElements(kml, 'Folder')[0] || kml;
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
            if (node) { node.features.push(f); f.__folderNode = node; matched++; }
        });
        return matched;
    }

    // 要素当前是否应显示（所在文件夹及所有上级都勾选）
    function isFeatureVisible(feature) {
        const node = feature.__folderNode;
        return !node || node.on;
    }

    function state(node) {
        let on = 0, off = 0;
        if (node.ids.length) (node.on ? on++ : off++);
        for (const c of node.children) {
            const s = state(c);
            if (s === 'mixed') return 'mixed';
            s === 'on' ? on++ : off++;
            if (on && off) return 'mixed';
        }
        return off ? (on ? 'mixed' : 'off') : 'on';
    }

    // 设置整棵子树的勾选状态，并把变化的已加载要素加入/移出图层
    function setSubtree(node, on, source) {
        const toAdd = [], toRemove = [];
        (function walk(n) {
            if (n.on !== on) {
                n.on = on;
                for (const f of n.features) {
                    if (!f.__loaded) continue;
                    (on ? toAdd : toRemove).push(f);
                }
            }
            n.children.forEach(walk);
        })(node);
        if (toRemove.length) source.removeFeatures(toRemove);
        if (toAdd.length) source.addFeatures(toAdd);
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

        const hasChildren = node.children.length > 0;
        const caret = document.createElement(hasChildren ? 'button' : 'span');
        caret.className = 'ft-caret';
        if (hasChildren) {
            row.classList.add('ft-row-expandable');
            caret.type = 'button';
            caret.setAttribute('aria-label', '子目录：' + node.name);
        }

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.setAttribute('aria-label', node.name);

        const label = document.createElement('span');
        label.className = 'ft-name';
        label.textContent = node.name;
        label.title = node.name;

        const count = document.createElement('span');
        count.className = 'ft-count';
        count.textContent = node.total;

        row.append(caret, cb, label, count);
        li.appendChild(row);

        let ul = null;
        function updateCaret() {
            caret.textContent = node.expanded ? '▼' : '▶';
            caret.setAttribute('aria-expanded', String(node.expanded));
        }

        function toggleExpand() {
            node.expanded = !node.expanded;
            updateCaret();
            if (node.expanded && !ul) {
                ul = document.createElement('ul');
                ul.className = 'ft-list';
                node.children.forEach(c => ul.appendChild(renderNode(c, tree)));
                li.appendChild(ul);
            }
            if (ul) ul.style.display = node.expanded ? '' : 'none';
            if (node.expanded) node.children.forEach(refresh);
        }
        if (hasChildren) {
            updateCaret();
            caret.addEventListener('click', toggleExpand);
            label.addEventListener('click', toggleExpand);
        }
        cb.addEventListener('change', function () {
            setSubtree(node, cb.checked, tree.source);
            refresh(tree.root);
        });

        node.el = { checkbox: cb, li: li, collapse: function () {
            if (node.expanded) toggleExpand();
        } };
        if (node.expanded) { node.expanded = false; toggleExpand(); }
        refresh(node);
        return li;
    }

    // 在 container 中渲染一棵树（根节点默认展开一层）
    function render(container, parsed, source, opts) {
        opts = opts || {};
        const tree = { root: parsed.root, source: source };
        parsed.root.expanded = !!opts.expanded && parsed.root.children.length > 0;
        const ul = document.createElement('ul');
        ul.className = 'ft-list ft-root';
        ul.appendChild(renderNode(parsed.root, tree));
        container.appendChild(ul);
        tree.setAll = function (on) { setSubtree(tree.root, on, source); refresh(tree.root); };
        tree.collapseAll = function () {
            (function walk(n) { n.children.forEach(walk); if (n.el) n.el.collapse(); })(tree.root);
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
