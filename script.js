"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const STORE = "mesi-swimlane-v2";
  const HEADER = 58,
    SIDE = 170,
    TOP = 82,
    PAD = 32;
  const TYPES = new Set(["process", "decision", "start", "end", "text"]);
  const PORTS = ["top", "right", "bottom", "left"];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const uid = (prefix) =>
    `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
  let model,
    selection = new Set(),
    selectedConnection = null,
    tool = "select",
    zoom = 1;
  let past = [],
    future = [],
    savedSnapshot = "",
    gesture = null,
    connectStart = null;
  let frame = 0,
    saveTimer = 0,
    toastTimer = 0,
    space = false,
    guides = [],
    exportBusy = false;
  let recoveryWorking = true,
    clipboard = null,
    tabConflict = false;
  const measure = document.createElement("canvas").getContext("2d");
  function initial() {
    return {
      format: "mesi-swimlane",
      version: 2,
      document: {
        title: "Untitled process",
        reference: "",
        revision: "1.0",
        date: new Date().toLocaleDateString("en-CA"),
        showFooter: true,
      },
      colWidth: 300,
      rowHeight: 200,
      stages: ["Project Initiation", "Development", "Verification"].map(
        (title) => ({ id: uid("stage"), title }),
      ),
      lanes: [
        "Product Manager",
        "Head of Development",
        "HW Dev Team Lead",
        "Embedded Sys Developer",
      ].map((title) => ({ id: uid("lane"), title })),
      shapes: [],
      connections: [],
    };
  }
  function num(v, min, max, name) {
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && v.trim() !== ""
          ? Number(v)
          : NaN;
    if (!Number.isFinite(n) || n < min || n > max)
      throw Error(`${name} must be between ${min} and ${max}.`);
    return n;
  }
  function text(v, max, name) {
    if (typeof v !== "string" || v.length > max)
      throw Error(`${name} must be text (${max} characters maximum).`);
    return v;
  }
  function array(v, max, name) {
    if (!Array.isArray(v) || v.length > max)
      throw Error(`${name} must be a list with at most ${max} items.`);
    return v;
  }
  function id(v) {
    return text(v, 160, "ID");
  }
  function normalize(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw Error("The file must contain a diagram object.");
    const legacy = raw.version === undefined;
    if (!legacy && (raw.version !== 2 || raw.format !== "mesi-swimlane"))
      throw Error("Unsupported diagram format or version.");
    const m = {
      format: "mesi-swimlane",
      version: 2,
      colWidth: num(raw.colWidth, 150, 800, "Column width"),
      rowHeight: num(raw.rowHeight, 100, 800, "Row height"),
    };
    m.document = legacy
      ? {
          title: "Imported process",
          reference: "",
          revision: "",
          date: "",
          showFooter: true,
        }
      : {
          title: text(raw.document?.title, 200, "Title"),
          reference: text(raw.document?.reference, 100, "Reference"),
          revision: text(raw.document?.revision, 50, "Revision"),
          date: text(raw.document?.date, 20, "Date"),
          showFooter: raw.document?.showFooter !== false,
        };
    const allIds = new Set();
    const unique = (v) => {
      v = id(v);
      if (!v || allIds.has(v))
        throw Error("All diagram IDs must be unique and non-empty.");
      allIds.add(v);
      return v;
    };
    m.stages = array(raw.stages, 60, "Stages").map((v, i) => ({
      id: unique(legacy ? `stage-import-${i}` : v.id),
      title: text(legacy ? v : v.title, 500, "Stage title"),
    }));
    m.lanes = array(raw.lanes, 100, "Lanes").map((v, i) => ({
      id: unique(legacy ? `lane-import-${i}` : v.id),
      title: text(legacy ? v : v.title, 500, "Lane title"),
    }));
    if (!m.stages.length || !m.lanes.length)
      throw Error("A diagram needs at least one stage and one lane.");
    const px = (v, name) => {
      if (typeof v !== "string" || !/^\d+(\.\d+)?px$/.test(v))
        throw Error(`${name} must be a positive pixel value.`);
      return num(parseFloat(v), 0, 100000, name);
    };
    m.shapes = array(raw.shapes, 500, "Shapes").map((s, i) => {
      if (!s || !TYPES.has(s.type)) throw Error("Unknown shape type.");
      const n = {
        id: unique(s.id),
        type: s.type,
        text: text(s.text, 10000, "Shape text"),
        width: legacy
          ? s.type === "decision"
            ? 140
            : s.type === "text"
              ? 100
              : 180
          : num(s.width, 40, 1200, "Shape width"),
        height: legacy
          ? s.type === "decision"
            ? 100
            : s.type === "text"
              ? 32
              : 70
          : num(s.height, 28, 1200, "Shape height"),
        z: legacy ? i : num(s.z, 0, 10000000, "Shape order"),
      };
      if (legacy) {
        const x = px(s.left || "40px", "Shape position"),
          y = px(s.top || "40px", "Shape position");
        const ci = Math.min(m.stages.length - 1, Math.floor(x / m.colWidth)),
          ri = Math.min(m.lanes.length - 1, Math.floor(y / m.rowHeight));
        n.stageId = m.stages[ci].id;
        n.laneId = m.lanes[ri].id;
        n.x = x - ci * m.colWidth;
        n.y = y - ri * m.rowHeight;
      } else {
        n.stageId = id(s.stageId);
        n.laneId = id(s.laneId);
        n.x = num(s.x, 0, 100000, "Shape X");
        n.y = num(s.y, 0, 100000, "Shape Y");
        if (
          !m.stages.some((x) => x.id === n.stageId) ||
          !m.lanes.some((x) => x.id === n.laneId)
        )
          throw Error("A shape refers to a missing stage or lane.");
      }
      return n;
    });
    const byId = new Map(m.shapes.map((s) => [s.id, s]));
    m.connections = array(raw.connections || [], 1000, "Connections").map(
      (c, i) => {
        if (
          !c ||
          !byId.has(c.from) ||
          !byId.has(c.to) ||
          c.from === c.to ||
          byId.get(c.from).type === "text" ||
          byId.get(c.to).type === "text"
        )
          throw Error("A connection has an invalid source or destination.");
        let fromPort = c.fromPort,
          toPort = c.toPort;
        if (legacy) {
          const a = position(byId.get(c.from), m),
            b = position(byId.get(c.to), m);
          [fromPort, toPort] = autoPorts(a, b);
        }
        if (!PORTS.includes(fromPort) || !PORTS.includes(toPort))
          throw Error("A connection has an invalid port.");
        return {
          id: unique(legacy ? `conn-import-${i}` : c.id),
          from: c.from,
          to: c.to,
          fromPort,
          toPort,
          label: legacy ? "" : text(c.label, 500, "Connection label"),
          points: legacy
            ? []
            : array(c.points || [], 50, "Route points").map((p) => ({
                x: num(p.x, 0, 100000, "Route X"),
                y: num(p.y, 0, 100000, "Route Y"),
              })),
        };
      },
    );
    return m;
  }
  function position(s, m = model) {
    return {
      x: m.stages.findIndex((v) => v.id === s.stageId) * m.colWidth + s.x,
      y: m.lanes.findIndex((v) => v.id === s.laneId) * m.rowHeight + s.y,
      w: s.width,
      h: s.height,
    };
  }
  function place(s, x, y) {
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    const ci = Math.min(
      model.stages.length - 1,
      Math.floor((x + s.width / 2) / model.colWidth),
    );
    const ri = Math.min(
      model.lanes.length - 1,
      Math.floor((y + s.height / 2) / model.rowHeight),
    );
    // Preserve non-negative cell offsets near a boundary: membership follows the top-left corner.
    const col = Math.min(ci, Math.floor(x / model.colWidth)),
      row = Math.min(ri, Math.floor(y / model.rowHeight));
    s.stageId = model.stages[col].id;
    s.laneId = model.lanes[row].id;
    s.x = x - col * model.colWidth;
    s.y = y - row * model.rowHeight;
  }
  function snapshot() {
    return JSON.stringify(model);
  }
  function remember() {
    return snapshot();
  }
  function finish(before) {
    if (before === snapshot()) return;
    past.push(before);
    if (past.length > 100) past.shift();
    future = [];
    changed();
  }
  function mutate(fn) {
    const before = remember();
    fn();
    finish(before);
  }
  function changed() {
    schedule();
    syncInspector();
    syncDocument();
    scheduleRecovery();
  }
  function dirty() {
    return snapshot() !== savedSnapshot;
  }
  function status() {
    $("save-status").textContent = tabConflict
      ? "Another tab changed recovery"
      : recoveryWorking
        ? dirty()
          ? "Unsaved JSON · browser recovery on"
          : "JSON saved · browser recovery on"
        : "Browser recovery unavailable · save JSON";
    $("undo-button").disabled = !past.length;
    $("redo-button").disabled = !future.length;
  }
  function scheduleRecovery() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 300);
    status();
  }
  function persist() {
    try {
      if (tabConflict) return;
      localStorage.setItem(
        STORE,
        JSON.stringify({
          model,
          savedSnapshot,
          updated: new Date().toISOString(),
        }),
      );
      recoveryWorking = true;
    } catch {
      recoveryWorking = false;
    }
    status();
  }
  function undo() {
    cancelGesture();
    if (!past.length) return;
    future.push(snapshot());
    model = JSON.parse(past.pop());
    selection.clear();
    selectedConnection = null;
    changed();
  }
  function redo() {
    cancelGesture();
    if (!future.length) return;
    past.push(snapshot());
    model = JSON.parse(future.pop());
    selection.clear();
    selectedConnection = null;
    changed();
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => ($("toast").hidden = true), 5500);
  }
  function element(tag, attrs = {}, parent) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (parent) parent.append(el);
    return el;
  }
  function html(tag, attrs = {}, content) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else el.setAttribute(k, v);
    }
    if (content !== undefined) el.textContent = content;
    return el;
  }
  function wrap(value, width, font = 14) {
    measure.font = `${font}px Arial`;
    const lines = [];
    for (const paragraph of String(value).split("\n")) {
      if (!paragraph) {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (measure.measureText(candidate).width <= width) {
          line = candidate;
          continue;
        }
        if (line) {
          lines.push(line);
          line = "";
        }
        if (measure.measureText(word).width <= width) {
          line = word;
          continue;
        }
        for (const ch of word) {
          if (line && measure.measureText(line + ch).width > width) {
            lines.push(line);
            line = "";
          }
          line += ch;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  function svgText(
    parent,
    value,
    x,
    y,
    width,
    {
      size = 14,
      color = "#173047",
      weight = 400,
      anchor = "middle",
      maxLines = Infinity,
    } = {},
  ) {
    const lines = wrap(value, width, size),
      shown = lines.slice(0, maxLines);
    if (lines.length > maxLines && shown.length)
      shown[shown.length - 1] = shown.at(-1).slice(0, -1) + "…";
    const t = element(
      "text",
      {
        x,
        y,
        fill: color,
        "font-size": size,
        "font-weight": weight,
        "text-anchor": anchor,
      },
      parent,
    );
    shown.forEach((line, i) => {
      const span = element(
        "tspan",
        { x, y: y + (i - (shown.length - 1) / 2) * size * 1.25 + size * 0.35 },
        t,
      );
      span.textContent = line;
    });
    return t;
  }
  function ensureTextFit(s) {
    const inset = s.type === "decision" ? Math.max(40, s.width * 0.42) : 24;
    const lines = wrap(
      s.text,
      Math.max(20, s.width - inset),
      s.type === "text" ? 13 : 14,
    );
    s.height = Math.min(
      1200,
      Math.max(
        s.height,
        Math.ceil(
          lines.length *
            (s.type === "text" ? 16.25 : 17.5) *
            (s.type === "decision" ? 1.8 : 1) +
            24,
        ),
      ),
    );
  }
  // Cache geometry across zoom, selection and export renders. Only document edits
  // invalidate routes; export bounds also include labels and routing detours.
  let layoutCache = null;
  function layout() {
    const key = snapshot();
    if (layoutCache?.key === key) return layoutCache;
    const positions = new Map(model.shapes.map((s) => [s.id, position(s)]));
    const routes = new Map(
      model.connections.map((c) => [c.id, route(c, positions)]),
    );
    let w = model.stages.length * model.colWidth;
    let h = model.lanes.length * model.rowHeight;
    for (const p of positions.values()) {
      w = Math.max(w, p.x + p.w + PAD);
      h = Math.max(h, p.y + p.h + PAD);
    }
    for (const c of model.connections) {
      const points = routes.get(c.id);
      for (const p of points) {
        w = Math.max(w, p.x + PAD);
        h = Math.max(h, p.y + PAD);
      }
      if (c.label) {
        const mid = midpoint(points);
        const lines = wrap(c.label, 180, 12);
        measure.font = "12px Arial";
        const labelWidth = Math.min(
          200,
          Math.max(...lines.map((v) => measure.measureText(v).width)) + 18,
        );
        w = Math.max(w, mid.x + labelWidth / 2 + PAD);
        h = Math.max(h, mid.y + (lines.length * 15 + 10) / 2 + PAD);
      }
    }
    return (layoutCache = {
      key,
      positions,
      routes,
      bounds: {
        width: SIDE + w + PAD,
        height: TOP + HEADER + h + PAD + (model.document.showFooter ? 44 : 0),
        contentW: w,
        contentH: h,
      },
    });
  }
  function extents() {
    return layout().bounds;
  }
  function schedule() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        render();
      });
  }
  function render() {
    const svg = $("diagram"),
      bounds = extents();
    const active = document.activeElement;
    const focusIdentity = svg.contains(active)
      ? ["data-node", "data-conn", "data-id"]
          .map((k) => [k, active.getAttribute(k)])
          .find(([, v]) => v !== null)
      : null;
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
    svg.setAttribute("width", bounds.width);
    svg.setAttribute("height", bounds.height);
    svg.style.transform = `scale(${zoom})`;
    $("canvas-spacer").style.width = `${bounds.width * zoom}px`;
    $("canvas-spacer").style.height = `${bounds.height * zoom}px`;
    svg.classList.toggle("connecting", tool === "connect" || !!connectStart);
    svg.style.cursor =
      tool === "pan" || space
        ? "grab"
        : tool === "connect"
          ? "crosshair"
          : "default";
    const defs = element("defs", {}, svg);
    const marker = element(
      "marker",
      {
        id: "arrow",
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 8,
        markerHeight: 8,
        orient: "auto-start-reverse",
        markerUnits: "userSpaceOnUse",
      },
      defs,
    );
    element("path", { d: "M 0 0 L 10 5 L 0 10 Z", fill: "#526979" }, marker);
    const selectedMarker = element(
      "marker",
      {
        id: "arrow-selected",
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 8,
        markerHeight: 8,
        orient: "auto",
      },
      defs,
    );
    element(
      "path",
      { d: "M 0 0 L 10 5 L 0 10 Z", fill: "#0284c7" },
      selectedMarker,
    );
    element(
      "rect",
      { width: bounds.width, height: bounds.height, fill: "white" },
      svg,
    );
    svgText(
      svg,
      model.document.title || "Untitled process",
      24,
      29,
      bounds.width - 48,
      { size: 23, weight: 700, anchor: "start", maxLines: 1 },
    );
    const meta = [
      model.document.reference,
      model.document.revision ? `Revision ${model.document.revision}` : "",
      model.document.date,
    ]
      .filter(Boolean)
      .join("  ·  ");
    svgText(svg, meta, 24, 57, bounds.width - 48, {
      size: 12,
      color: "#6b8090",
      anchor: "start",
      maxLines: 1,
    });
    element(
      "rect",
      { x: 0, y: TOP, width: SIDE, height: HEADER, fill: "#123c4c" },
      svg,
    );
    svgText(svg, "RESPONSIBILITY", SIDE / 2, TOP + HEADER / 2, SIDE - 20, {
      size: 10,
      weight: 700,
      color: "#c5e4e6",
    });
    for (let i = 0; i < model.stages.length; i++) {
      const st = model.stages[i];
      const g = element(
        "g",
        {
          "data-grid": "stage",
          "data-id": st.id,
          tabindex: 0,
          role: "button",
          "aria-label": `Edit stage ${st.title}`,
        },
        svg,
      );
      element(
        "rect",
        {
          x: SIDE + i * model.colWidth,
          y: TOP,
          width: model.colWidth,
          height: HEADER,
          fill: i % 2 ? "#107b73" : "#0f766e",
          stroke: "#ffffff55",
        },
        g,
      );
      svgText(
        g,
        st.title,
        SIDE + (i + 0.5) * model.colWidth,
        TOP + HEADER / 2,
        model.colWidth - 24,
        { size: 14, weight: 700, color: "white", maxLines: 2 },
      );
    }
    for (let i = 0; i < model.lanes.length; i++) {
      const lane = model.lanes[i],
        y = TOP + HEADER + i * model.rowHeight;
      const g = element(
        "g",
        {
          "data-grid": "lane",
          "data-id": lane.id,
          tabindex: 0,
          role: "button",
          "aria-label": `Edit responsibility ${lane.title}`,
        },
        svg,
      );
      element(
        "rect",
        {
          x: 0,
          y,
          width: SIDE,
          height: model.rowHeight,
          fill: i % 2 ? "#214459" : "#193b4e",
          stroke: "#476273",
        },
        g,
      );
      svgText(g, lane.title, SIDE / 2, y + model.rowHeight / 2, SIDE - 24, {
        size: 14,
        weight: 600,
        color: "white",
        maxLines: Math.max(1, Math.floor((model.rowHeight - 20) / 18)),
      });
      for (let j = 0; j < model.stages.length; j++)
        element(
          "rect",
          {
            x: SIDE + j * model.colWidth,
            y,
            width: model.colWidth,
            height: model.rowHeight,
            fill: i % 2 ? "#f0f5f8" : "#f8fafb",
            stroke: "#d8e2e9",
          },
          svg,
        );
    }
    const content = element(
      "g",
      { transform: `translate(${SIDE} ${TOP + HEADER})` },
      svg,
    );
    const { positions, routes } = layout();
    for (const c of model.connections)
      renderConnection(content, c, positions, routes.get(c.id));
    for (const s of [...model.shapes].sort((a, b) => a.z - b.z))
      renderShape(content, s, positions.get(s.id));
    for (const guide of guides)
      element(
        "line",
        {
          ...guide,
          stroke: "#db4b91",
          "stroke-width": 1,
          "stroke-dasharray": "5 4",
          class: "editor-only",
        },
        content,
      );
    if (gesture?.kind === "connect" && gesture.current) {
      const a = portPoint(positions.get(gesture.from), gesture.port),
        b = gesture.current;
      element(
        "path",
        {
          d: `M${a.x},${a.y} L${b.x},${b.y}`,
          fill: "none",
          stroke: "#0284c7",
          "stroke-width": 2,
          "stroke-dasharray": "6 4",
          class: "editor-only",
          "pointer-events": "none",
        },
        content,
      );
    }
    if (model.document.showFooter) {
      element(
        "line",
        {
          x1: 24,
          y1: bounds.height - 43,
          x2: bounds.width - 24,
          y2: bounds.height - 43,
          stroke: "#d8e2e9",
        },
        svg,
      );
      svgText(
        svg,
        [
          model.document.reference,
          model.document.title,
          model.document.revision ? `Rev. ${model.document.revision}` : "",
          model.document.date,
        ]
          .filter(Boolean)
          .join("  |  "),
        24,
        bounds.height - 22,
        bounds.width - 48,
        { size: 10, color: "#6b8090", anchor: "start", maxLines: 1 },
      );
    }
    if (focusIdentity) {
      const [key, value] = focusIdentity;
      [...svg.querySelectorAll('[tabindex="0"]')]
        .find((el) => el.getAttribute(key) === value)
        ?.focus({ preventScroll: true });
    }
    $("diagram-stats").textContent =
      `${model.shapes.length} shapes · ${model.connections.length} connectors`;
  }
  function renderShape(parent, s, p) {
    const selected = selection.has(s.id);
    const g = element(
      "g",
      {
        "data-node": s.id,
        class: selected ? "selected" : "",
        tabindex: 0,
        role: "button",
        "aria-label": `${s.type}: ${s.text}`,
        transform: `translate(${p.x} ${p.y})`,
      },
      parent,
    );
    const stroke = selected ? "#0284c7" : "#36596b";
    if (selected)
      element(
        "rect",
        {
          x: -5,
          y: -5,
          width: p.w + 10,
          height: p.h + 10,
          rx: 10,
          fill: "none",
          stroke: "#0284c7",
          "stroke-dasharray": "4 3",
          "stroke-width": 1.5,
          class: "editor-only",
        },
        g,
      );
    if (s.type === "decision")
      element(
        "polygon",
        {
          points: `${p.w / 2},1 ${p.w - 1},${p.h / 2} ${p.w / 2},${p.h - 1} 1,${p.h / 2}`,
          fill: "#fff5d9",
          stroke,
          "stroke-width": 1.7,
          class: "shape-outline",
        },
        g,
      );
    else if (s.type === "text")
      element(
        "rect",
        {
          width: p.w,
          height: p.h,
          rx: 4,
          fill: "none",
          "pointer-events": "all",
          stroke: selected ? "#0284c7" : "none",
          class: "shape-outline",
        },
        g,
      );
    else
      element(
        "rect",
        {
          width: p.w,
          height: p.h,
          rx: s.type === "process" ? 9 : Math.min(p.w, p.h) / 2,
          fill:
            s.type === "start"
              ? "#d9f0e7"
              : s.type === "end"
                ? "#ffe4e6"
                : "#e7f3fc",
          stroke,
          "stroke-width": s.type === "end" ? 3 : 1.7,
          class: "shape-outline",
        },
        g,
      );
    svgText(
      g,
      s.text,
      p.w / 2,
      p.h / 2,
      s.type === "decision" ? p.w * 0.58 : p.w - 24,
      {
        size: s.type === "text" ? 13 : 14,
        weight: s.type === "text" ? 600 : 400,
        maxLines: Math.max(
          1,
          Math.floor((p.h - 12) / (s.type === "decision" ? 31.5 : 17.5)),
        ),
      },
    );
    if (s.type !== "text")
      for (const port of PORTS) {
        const q = portPoint({ x: 0, y: 0, w: p.w, h: p.h }, port);
        element(
          "circle",
          {
            cx: q.x,
            cy: q.y,
            r: 9,
            fill: "#0284c7",
            stroke: "white",
            "stroke-width": 2,
            "data-port": port,
            "data-node": s.id,
            class: "port editor-only",
          },
          g,
        );
      }
    if (selected && selection.size === 1)
      element(
        "rect",
        {
          x: p.w - 7,
          y: p.h - 7,
          width: 14,
          height: 14,
          rx: 3,
          fill: "#0284c7",
          stroke: "white",
          "stroke-width": 2,
          "data-resize": s.id,
          class: "resize-handle editor-only",
        },
        g,
      );
  }
  function portPoint(p, side) {
    if (side === "top") return { x: p.x + p.w / 2, y: p.y };
    if (side === "bottom") return { x: p.x + p.w / 2, y: p.y + p.h };
    if (side === "left") return { x: p.x, y: p.y + p.h / 2 };
    return { x: p.x + p.w, y: p.y + p.h / 2 };
  }
  function autoPorts(a, b) {
    return Math.abs(a.x + a.w / 2 - b.x - b.w / 2) >
      Math.abs(a.y + a.h / 2 - b.y - b.h / 2)
      ? a.x < b.x
        ? ["right", "left"]
        : ["left", "right"]
      : a.y < b.y
        ? ["bottom", "top"]
        : ["top", "bottom"];
  }
  const vector = (side) =>
    side === "top"
      ? { x: 0, y: -1 }
      : side === "bottom"
        ? { x: 0, y: 1 }
        : side === "left"
          ? { x: -1, y: 0 }
          : { x: 1, y: 0 };
  const eq = (a, b) => Math.abs(a.x - b.x) < 0.1 && Math.abs(a.y - b.y) < 0.1;
  function compact(points) {
    const out = [];
    for (const p of points) {
      if (out.length && eq(out.at(-1), p)) continue;
      out.push(p);
      while (out.length >= 3) {
        const [a, b, c] = out.slice(-3);
        if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y))
          out.splice(out.length - 2, 1);
        else break;
      }
    }
    return out;
  }
  function blocked(a, b, rects) {
    return rects.some((r) =>
      a.x === b.x
        ? a.x > r.x &&
          a.x < r.x + r.w &&
          Math.max(a.y, b.y) > r.y &&
          Math.min(a.y, b.y) < r.y + r.h
        : a.y > r.y &&
          a.y < r.y + r.h &&
          Math.max(a.x, b.x) > r.x &&
          Math.min(a.x, b.x) < r.x + r.w,
    );
  }
  // Orthogonal visibility-grid search. Cost includes distance and a bend penalty.
  function avoid(a, b, rects) {
    const candidates = [
      [a, { x: b.x, y: a.y }, b],
      [a, { x: a.x, y: b.y }, b],
    ];
    for (const p of candidates)
      if (!blocked(p[0], p[1], rects) && !blocked(p[1], p[2], rects))
        return compact(p);
    const relevant = rects.filter(
      (r) =>
        r.x + r.w >= Math.min(a.x, b.x) - 250 &&
        r.x <= Math.max(a.x, b.x) + 250 &&
        r.y + r.h >= Math.min(a.y, b.y) - 250 &&
        r.y <= Math.max(a.y, b.y) + 250,
    );
    const xs = [
        ...new Set([
          a.x,
          b.x,
          0,
          ...relevant.flatMap((r) => [Math.max(0, r.x), r.x + r.w]),
        ]),
      ].sort((x, y) => x - y),
      ys = [
        ...new Set([
          a.y,
          b.y,
          0,
          ...relevant.flatMap((r) => [Math.max(0, r.y), r.y + r.h]),
        ]),
      ].sort((x, y) => x - y);
    const index = (xi, yi, dir) => (yi * xs.length + xi) * 2 + dir;
    const start = {
      xi: xs.indexOf(a.x),
      yi: ys.indexOf(a.y),
      dir: 0,
      g: 0,
      prev: null,
    };
    start.f = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const heap = [];
    const push = (n) => {
      heap.push(n);
      let i = heap.length - 1;
      while (i) {
        const j = (i - 1) >> 1;
        if (heap[j].f <= n.f) break;
        heap[i] = heap[j];
        i = j;
      }
      heap[i] = n;
    };
    const pop = () => {
      const top = heap[0],
        last = heap.pop();
      if (heap.length) {
        let i = 0;
        heap[0] = last;
        for (;;) {
          let child = i * 2 + 1;
          if (child >= heap.length) break;
          if (child + 1 < heap.length && heap[child + 1].f < heap[child].f)
            child++;
          if (heap[child].f >= last.f) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = last;
      }
      return top;
    };
    push(start);
    const costs = new Map([[index(start.xi, start.yi, 0), 0]]);
    let count = 0;
    while (heap.length && count++ < 20000) {
      const cur = pop(),
        p = { x: xs[cur.xi], y: ys[cur.yi] };
      if (eq(p, b)) {
        const result = [];
        for (let n = cur; n; n = n.prev)
          result.unshift({ x: xs[n.xi], y: ys[n.yi] });
        return compact(result);
      }
      if (cur.g > costs.get(index(cur.xi, cur.yi, cur.dir))) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const xi = cur.xi + dx,
          yi = cur.yi + dy;
        if (xi < 0 || yi < 0 || xi >= xs.length || yi >= ys.length) continue;
        const q = { x: xs[xi], y: ys[yi] };
        if (blocked(p, q, rects)) continue;
        const dir = dx ? 0 : 1,
          g =
            cur.g +
            Math.abs(q.x - p.x) +
            Math.abs(q.y - p.y) +
            (dir !== cur.dir ? 18 : 0),
          key = index(xi, yi, dir);
        if (g >= (costs.get(key) ?? Infinity)) continue;
        costs.set(key, g);
        push({
          xi,
          yi,
          dir,
          g,
          f: g + Math.abs(q.x - b.x) + Math.abs(q.y - b.y),
          prev: cur,
        });
      }
    }
    // Crowded/overlapping diagrams can have no clear route; provide a deterministic fallback.
    return compact(candidates[0]);
  }
  function route(c, positions) {
    const a = portPoint(positions.get(c.from), c.fromPort),
      b = portPoint(positions.get(c.to), c.toPort),
      av = vector(c.fromPort),
      bv = vector(c.toPort);
    const stub = 22;
    const a1 = {
        x: Math.max(0, a.x + av.x * stub),
        y: Math.max(0, a.y + av.y * stub),
      },
      b1 = {
        x: Math.max(0, b.x + bv.x * stub),
        y: Math.max(0, b.y + bv.y * stub),
      };
    const rects = [...positions.entries()]
      .filter(
        ([key]) => model.shapes.find((s) => s.id === key)?.type !== "text",
      )
      .map(([, p]) => ({ x: p.x - 10, y: p.y - 10, w: p.w + 20, h: p.h + 20 }));
    if (c.points.length) {
      const anchors = [a1, ...c.points, b1],
        out = [a];
      for (let i = 1; i < anchors.length; i++) {
        const p = anchors[i - 1],
          q = anchors[i];
        out.push(p, { x: q.x, y: p.y }, q);
      }
      out.push(b);
      return compact(out);
    }
    return compact([a, ...avoid(a1, b1, rects), b]);
  }
  function pathD(points) {
    return points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  }
  function midpoint(points) {
    let length = 0;
    for (let i = 1; i < points.length; i++)
      length +=
        Math.abs(points[i].x - points[i - 1].x) +
        Math.abs(points[i].y - points[i - 1].y);
    let target = length / 2;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        d = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (target <= d)
        return {
          x: a.x + (b.x - a.x) * (target / (d || 1)),
          y: a.y + (b.y - a.y) * (target / (d || 1)),
        };
      target -= d;
    }
    return points[0];
  }
  function renderConnection(parent, c, positions, cachedPoints) {
    const points = cachedPoints || route(c, positions),
      selected = selectedConnection === c.id,
      g = element(
        "g",
        {
          "data-conn": c.id,
          tabindex: 0,
          role: "button",
          "aria-label": `Connector ${c.label || "unlabelled"}`,
        },
        parent,
      );
    element(
      "path",
      {
        d: pathD(points),
        fill: "none",
        stroke: "transparent",
        "stroke-width": 20,
        class: "editor-only",
      },
      g,
    );
    element(
      "path",
      {
        d: pathD(points),
        fill: "none",
        stroke: selected ? "#0284c7" : "#526979",
        "stroke-width": selected ? 2.5 : 1.8,
        "stroke-linejoin": "round",
        "marker-end": `url(#${selected ? "arrow-selected" : "arrow"})`,
      },
      g,
    );
    const middle = midpoint(points);
    if (c.label) {
      const lines = wrap(c.label, 180, 12),
        width = Math.min(
          200,
          Math.max(
            ...lines.map((x) => {
              measure.font = "12px Arial";
              return measure.measureText(x).width;
            }),
          ) + 18,
        ),
        height = lines.length * 15 + 10;
      element(
        "rect",
        {
          x: middle.x - width / 2,
          y: middle.y - height / 2,
          width,
          height,
          rx: 5,
          fill: "none",
          stroke: "none",
          "pointer-events": "all",
        },
        g,
      );
      svgText(g, c.label, middle.x, middle.y, 180, { size: 12, weight: 600 });
    }
    if (selected) {
      const handles = c.points.length ? c.points : [middle];
      handles.forEach((p, i) =>
        element(
          "rect",
          {
            x: p.x - 7,
            y: p.y - 7,
            width: 14,
            height: 14,
            rx: 3,
            fill: "#ed9b26",
            stroke: "white",
            "stroke-width": 2,
            "data-route": c.id,
            "data-point": c.points.length ? i : -1,
            class: "route-handle editor-only",
          },
          g,
        ),
      );
    }
  }
  function syncDocument() {
    const d = model.document;
    for (const [key, value] of Object.entries({
      "doc-title": d.title,
      "doc-reference": d.reference,
      "doc-revision": d.revision,
      "doc-date": d.date,
      "col-width": model.colWidth,
      "row-height": model.rowHeight,
    })) {
      if (document.activeElement !== $(key)) $(key).value = value;
    }
    $("doc-footer").checked = d.showFooter;
    renderGridList("stage");
    renderGridList("lane");
    status();
  }
  function button(label, action, attrs = {}) {
    const b = html("button", { type: "button", ...attrs }, label);
    b.addEventListener("click", action);
    return b;
  }
  function field(
    parent,
    label,
    value,
    onChange,
    { type = "text", min, max, options } = {},
  ) {
    const box = html("label", {}, label);
    let input;
    if (type === "textarea") input = html("textarea");
    else if (type === "select") {
      input = html("select");
      options.forEach((o) =>
        input.append(html("option", { value: o.id }, o.title)),
      );
    } else
      input = html("input", {
        type,
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
      });
    input.value = value;
    input.addEventListener("change", () => onChange(input.value));
    box.append(input);
    parent.append(box);
    return input;
  }
  function syncInspector() {
    const panel = $("selection-panel");
    panel.replaceChildren();
    if (selectedConnection) {
      const c = model.connections.find((x) => x.id === selectedConnection);
      if (!c) {
        selectedConnection = null;
        return syncInspector();
      }
      panel.append(html("h3", {}, "Connector"));
      field(
        panel,
        "Label",
        c.label,
        (value) => mutate(() => (c.label = value.slice(0, 500))),
        { type: "textarea" },
      );
      field(
        panel,
        "Source side",
        c.fromPort,
        (value) => mutate(() => (c.fromPort = value)),
        { type: "select", options: PORTS.map((id) => ({ id, title: id })) },
      );
      field(
        panel,
        "Destination side",
        c.toPort,
        (value) => mutate(() => (c.toPort = value)),
        { type: "select", options: PORTS.map((id) => ({ id, title: id })) },
      );
      panel.append(
        html(
          "p",
          { class: "route-note" },
          "Drag the orange handle to set a route. Add route points for additional control. Manual routes stay fixed until you move their points.",
        ),
      );
      panel.append(
        button("Add route point", () => {
          mutate(() => {
            if (c.points.length >= 50) {
              toast("Maximum 50 route points per connector.");
              return;
            }
            const positions = new Map(
              model.shapes.map((s) => [s.id, position(s)]),
            );
            const p = midpoint(route(c, positions));
            c.points.push({
              x: Math.max(0, p.x + 30 * c.points.length),
              y: Math.max(0, p.y + 30 * c.points.length),
            });
          });
        }),
      );
      panel.append(
        button("Reset automatic route", () => mutate(() => (c.points = []))),
      );
      panel.append(
        button("Delete connector", deleteSelection, { class: "danger" }),
      );
      return;
    }
    const selected = model.shapes.filter((s) => selection.has(s.id));
    if (!selected.length) {
      panel.append(
        html(
          "p",
          { class: "muted" },
          "Select a shape or connector to edit it.",
        ),
      );
      return;
    }
    panel.append(
      html(
        "h3",
        {},
        selected.length === 1
          ? "Shape properties"
          : `${selected.length} shapes selected`,
      ),
    );
    if (selected.length === 1) {
      const s = selected[0];
      field(
        panel,
        "Text",
        s.text,
        (value) =>
          mutate(() => {
            s.text = value.slice(0, 10000);
            ensureTextFit(s);
          }),
        { type: "textarea" },
      );
      field(
        panel,
        "Shape",
        s.type,
        (value) =>
          mutate(() => {
            s.type = value;
            ensureTextFit(s);
            if (value === "text")
              model.connections = model.connections.filter(
                (c) => c.from !== s.id && c.to !== s.id,
              );
          }),
        {
          type: "select",
          options: [...TYPES].map((id) => ({
            id,
            title: id[0].toUpperCase() + id.slice(1),
          })),
        },
      );
      const row = html("div", { class: "two-col" });
      field(row, "Width", s.width, (v) => resizeProperty(s, "width", v), {
        type: "number",
        min: 40,
        max: 1200,
      });
      field(row, "Height", s.height, (v) => resizeProperty(s, "height", v), {
        type: "number",
        min: 28,
        max: 1200,
      });
      panel.append(row);
      field(
        panel,
        "Stage",
        s.stageId,
        (v) =>
          mutate(() => {
            s.stageId = v;
          }),
        { type: "select", options: model.stages },
      );
      field(
        panel,
        "Responsibility",
        s.laneId,
        (v) =>
          mutate(() => {
            s.laneId = v;
          }),
        { type: "select", options: model.lanes },
      );
      const zrow = html("div", { class: "selection-actions" });
      zrow.append(
        button("Bring forward", () =>
          mutate(
            () => (s.z = Math.max(0, ...model.shapes.map((s) => s.z)) + 1),
          ),
        ),
        button("Send back", () =>
          mutate(() => {
            model.shapes.forEach((s) => s.z++);
            s.z = 0;
          }),
        ),
      );
      panel.append(zrow);
    }
    panel.append(
      button("Duplicate selection", duplicateSelection),
      button("Delete selection", deleteSelection, { class: "danger" }),
    );
  }
  function resizeProperty(s, key, value) {
    try {
      const n = num(value, key === "width" ? 40 : 28, 1200, key);
      mutate(() => {
        s[key] = n;
        ensureTextFit(s);
      });
    } catch (e) {
      toast(e.message);
      syncInspector();
    }
  }
  function renderGridList(kind) {
    const list = $(kind + "-list"),
      items = kind === "stage" ? model.stages : model.lanes;
    list.replaceChildren();
    items.forEach((item, i) => {
      const row = html("div", { class: "grid-item" });
      row.append(
        button(item.title, () => editGrid(kind, item.id), {
          class: "grid-name",
          title: `Edit ${item.title}`,
        }),
      );
      const up = button("↑", () => moveGrid(kind, item.id, -1), {
        "aria-label": `Move ${item.title} earlier`,
      });
      up.disabled = i === 0;
      const down = button("↓", () => moveGrid(kind, item.id, 1), {
        "aria-label": `Move ${item.title} later`,
      });
      down.disabled = i === items.length - 1;
      const del = button("×", () => deleteGrid(kind, item.id), {
        class: "danger",
        "aria-label": `Delete ${item.title}`,
      });
      del.disabled = items.length === 1;
      row.append(up, down, del);
      list.append(row);
    });
  }
  function moveGrid(kind, key, delta) {
    mutate(() => {
      const list = kind === "stage" ? model.stages : model.lanes,
        i = list.findIndex((x) => x.id === key),
        j = i + delta;
      if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
    });
  }
  function dialog(title, build, actions) {
    if ($("editor-dialog").open) $("editor-dialog").close();
    $("dialog-title").textContent = title;
    $("dialog-body").replaceChildren();
    $("dialog-actions").replaceChildren();
    build($("dialog-body"));
    for (const a of actions)
      $("dialog-actions").append(
        button(
          a.label,
          () => {
            if (a.run?.() === false) return;
            $("editor-dialog").close();
          },
          a.primary
            ? { class: "primary" }
            : a.danger
              ? { class: "danger" }
              : {},
        ),
      );
    $("editor-dialog").showModal();
  }
  function editText(title, value, commit, max = 10000) {
    let input;
    dialog(
      title,
      (body) => {
        input = field(body, "Text", value, () => {}, { type: "textarea" });
        input.maxLength = max;
      },
      [
        { label: "Cancel" },
        { label: "Apply", primary: true, run: () => commit(input.value) },
      ],
    );
    input.focus();
    input.select();
  }
  function editGrid(kind, key) {
    const list = kind === "stage" ? model.stages : model.lanes,
      item = list.find((x) => x.id === key);
    editText(
      kind === "stage" ? "Edit stage" : "Edit responsibility",
      item.title,
      (value) => mutate(() => (item.title = value)),
      500,
    );
  }
  function deleteGrid(kind, key) {
    const list = kind === "stage" ? model.stages : model.lanes;
    if (list.length === 1)
      return toast("Keep at least one stage and one responsibility.");
    const prop = kind === "stage" ? "stageId" : "laneId",
      index = list.findIndex((x) => x.id === key),
      affected = model.shapes.filter((s) => s[prop] === key);
    let destination = list[index ? index - 1 : 1].id;
    const apply = (remove) =>
      mutate(() => {
        if (remove) {
          const ids = new Set(affected.map((s) => s.id));
          model.shapes = model.shapes.filter((s) => !ids.has(s.id));
          model.connections = model.connections.filter(
            (c) => !ids.has(c.from) && !ids.has(c.to),
          );
          selection.clear();
          selectedConnection = null;
        } else affected.forEach((s) => (s[prop] = destination));
        list.splice(index, 1);
      });
    dialog(
      `Delete ${kind === "stage" ? "stage" : "responsibility"}?`,
      (body) => {
        body.append(
          html(
            "p",
            {},
            `“${list[index].title}” contains ${affected.length} shape${affected.length === 1 ? "" : "s"}. The other rows/columns and their shapes will move together.`,
          ),
        );
        if (affected.length)
          field(body, "Move shapes to", destination, (v) => (destination = v), {
            type: "select",
            options: list.filter((x) => x.id !== key),
          });
      },
      [
        { label: "Cancel" },
        ...(affected.length
          ? [
              {
                label: "Move shapes & delete",
                primary: true,
                run: () => apply(false),
              },
              {
                label: "Delete with shapes",
                danger: true,
                run: () => apply(true),
              },
            ]
          : [{ label: "Delete", danger: true, run: () => apply(false) }]),
      ],
    );
  }
  function addShape(type) {
    if (model.shapes.length >= 500)
      return toast("This diagram has reached the 500-shape limit.");
    const p = canvasPoint({
      clientX:
        $("viewport").getBoundingClientRect().left +
        $("viewport").clientWidth / 2,
      clientY:
        $("viewport").getBoundingClientRect().top +
        $("viewport").clientHeight / 2,
    });
    mutate(() => {
      const s = {
        id: uid("shape"),
        type,
        text:
          type === "process"
            ? "Process step"
            : type === "decision"
              ? "Decision?"
              : type === "text"
                ? "Text label"
                : type === "start"
                  ? "Start"
                  : "End",
        width: type === "decision" ? 200 : type === "process" ? 180 : 140,
        height:
          type === "decision"
            ? 130
            : type === "process"
              ? 76
              : type === "text"
                ? 36
                : 54,
        z: Math.max(0, ...model.shapes.map((s) => s.z)) + 1,
      };
      place(s, p.x - s.width / 2, p.y - s.height / 2);
      model.shapes.push(s);
      selection = new Set([s.id]);
      selectedConnection = null;
    });
    setTool("select");
  }
  function deleteSelection() {
    if (selectedConnection) {
      mutate(() => {
        model.connections = model.connections.filter(
          (c) => c.id !== selectedConnection,
        );
        selectedConnection = null;
      });
      return;
    }
    if (!selection.size) return;
    mutate(() => {
      model.shapes = model.shapes.filter((s) => !selection.has(s.id));
      model.connections = model.connections.filter(
        (c) => !selection.has(c.from) && !selection.has(c.to),
      );
      selection.clear();
    });
  }
  function duplicateSelection() {
    if (model.shapes.length + selection.size > 500)
      return toast("Duplicating would exceed the 500-shape limit.");
    if (!selection.size) return toast("Select one or more shapes first.");
    const selected = model.shapes.filter((s) => selection.has(s.id)),
      ids = new Map(selected.map((s) => [s.id, uid("shape")]));
    mutate(() => {
      const copies = selected.map((s) => {
        const n = clone(s),
          p = position(s);
        n.id = ids.get(s.id);
        n.z = Math.max(0, ...model.shapes.map((s) => s.z)) + 1;
        place(n, p.x + 24, p.y + 24);
        return n;
      });
      const conns = model.connections
        .filter((c) => ids.has(c.from) && ids.has(c.to))
        .map((c) => ({
          ...clone(c),
          id: uid("conn"),
          from: ids.get(c.from),
          to: ids.get(c.to),
          points: c.points.map((p) => ({ x: p.x + 24, y: p.y + 24 })),
        }));
      if (model.connections.length + conns.length > 1000) {
        toast("Duplicating would exceed the connector limit.");
        return;
      }
      model.shapes.push(...copies);
      model.connections.push(...conns);
      selection = new Set(copies.map((s) => s.id));
    });
  }
  function align(kind) {
    const nodes = model.shapes.filter((s) => selection.has(s.id));
    if (nodes.length < 2) return toast("Select at least two shapes to align.");
    if ((kind === "horizontal" || kind === "vertical") && nodes.length < 3)
      return toast("Select at least three shapes to distribute.");
    mutate(() => {
      const p = nodes.map((s) => ({ s, ...position(s) }));
      const minX = Math.min(...p.map((p) => p.x)),
        minY = Math.min(...p.map((p) => p.y)),
        maxX = Math.max(...p.map((p) => p.x + p.w)),
        maxY = Math.max(...p.map((p) => p.y + p.h));
      if (kind === "horizontal" || kind === "vertical") {
        const axis = kind === "horizontal" ? "x" : "y",
          size = axis === "x" ? "w" : "h";
        p.sort((a, b) => a[axis] - b[axis]);
        const start = p[0][axis],
          end = p.at(-1)[axis] + p.at(-1)[size],
          gap =
            (end - start - p.reduce((sum, p) => sum + p[size], 0)) /
            (p.length - 1);
        let cursor = start;
        for (const v of p) {
          place(v.s, axis === "x" ? cursor : v.x, axis === "y" ? cursor : v.y);
          cursor += v[size] + gap;
        }
      } else
        for (const v of p)
          place(
            v.s,
            kind === "x"
              ? (minX + maxX - v.w) / 2
              : kind === "left"
                ? minX
                : v.x,
            kind === "y"
              ? (minY + maxY - v.h) / 2
              : kind === "top"
                ? minY
                : v.y,
          );
    });
  }
  function setTool(value) {
    cancelGesture();
    tool = value;
    connectStart = null;
    for (const v of ["select", "pan", "connect"])
      $(v + "-tool").classList.toggle("active", tool === v);
    $("context-hint").textContent =
      value === "connect"
        ? "Tap source, then destination · Or drag between blue ports · Escape cancels"
        : value === "pan"
          ? "Drag anywhere to pan · Use zoom controls to change scale"
          : "Drag to move · Shift-click for groups · Double-click to edit";
    schedule();
  }
  function canvasPoint(e) {
    const r = $("diagram").getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / zoom - SIDE,
      y: (e.clientY - r.top) / zoom - TOP - HEADER,
    };
  }
  function selectNode(key, add = false) {
    selectedConnection = null;
    if (add) {
      if (selection.has(key)) selection.delete(key);
      else selection.add(key);
    } else if (!selection.has(key)) selection = new Set([key]);
    syncInspector();
    schedule();
  }
  function addConnection(from, to, fromPort, toPort) {
    if (model.connections.length >= 1000)
      return toast("This diagram has reached the 1,000-connector limit.");
    if (from === to) return;
    const a = model.shapes.find((s) => s.id === from),
      b = model.shapes.find((s) => s.id === to);
    if (!a || !b || a.type === "text" || b.type === "text") return;
    const ports = autoPorts(position(a), position(b));
    fromPort = fromPort || ports[0];
    toPort = toPort || ports[1];
    if (
      model.connections.some(
        (c) =>
          c.from === from &&
          c.to === to &&
          c.fromPort === fromPort &&
          c.toPort === toPort,
      )
    )
      return toast("That connection already exists.");
    mutate(() => {
      const c = {
        id: uid("conn"),
        from,
        to,
        fromPort,
        toPort,
        label: "",
        points: [],
      };
      model.connections.push(c);
      selection.clear();
      selectedConnection = c.id;
    });
  }
  function nearestPort(s, p) {
    const r = position(s);
    return [...PORTS].sort((a, b) => {
      const x = portPoint(r, a),
        y = portPoint(r, b);
      return (
        Math.hypot(x.x - p.x, x.y - p.y) - Math.hypot(y.x - p.x, y.y - p.y)
      );
    })[0];
  }
  function cancelGesture() {
    if (gesture?.before) {
      model = JSON.parse(gesture.before);
      schedule();
      syncInspector();
    }
    gesture = null;
    guides = [];
    connectStart = null;
    schedule();
  }
  $("viewport").addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (exportBusy) return;
    const target = e.target,
      point = canvasPoint(e),
      nodeId = target.closest("[data-node]")?.getAttribute("data-node"),
      connId = target.closest("[data-conn]")?.getAttribute("data-conn");
    if (tool === "pan" || space || e.button === 1) {
      gesture = {
        kind: "pan",
        x: e.clientX,
        y: e.clientY,
        left: $("viewport").scrollLeft,
        top: $("viewport").scrollTop,
      };
    } else if (target.hasAttribute("data-route")) {
      const c = model.connections.find(
        (c) => c.id === target.getAttribute("data-route"),
      );
      const before = remember();
      let index = Number(target.getAttribute("data-point"));
      if (index < 0) {
        c.points = [point];
        index = 0;
      }
      gesture = { kind: "route", id: c.id, index, before };
    } else if (target.hasAttribute("data-resize")) {
      const s = model.shapes.find(
        (s) => s.id === target.getAttribute("data-resize"),
      );
      gesture = {
        kind: "resize",
        id: s.id,
        start: point,
        w: s.width,
        h: s.height,
        before: remember(),
      };
    } else if (target.hasAttribute("data-port")) {
      gesture = {
        kind: "connect",
        from: nodeId,
        port: target.getAttribute("data-port"),
        current: point,
      };
    } else if (nodeId && tool === "connect") {
      const s = model.shapes.find((s) => s.id === nodeId);
      if (s.type === "text") return;
      if (connectStart) {
        addConnection(connectStart, nodeId);
        connectStart = null;
      } else {
        connectStart = nodeId;
        toast("Now select the destination shape.");
      }
      schedule();
      return;
    } else if (nodeId) {
      selectNode(nodeId, e.shiftKey);
      if (!selection.has(nodeId)) return;
      gesture = {
        kind: "move",
        start: point,
        before: remember(),
        positions: model.shapes
          .filter((s) => selection.has(s.id))
          .map((s) => ({ id: s.id, ...position(s) })),
        moved: false,
      };
    } else if (connId) {
      selection.clear();
      selectedConnection = connId;
      syncInspector();
      schedule();
      return;
    } else if (target.closest("[data-grid]")) {
      return;
    } else {
      selection.clear();
      selectedConnection = null;
      connectStart = null;
      syncInspector();
      schedule();
      return;
    }
    e.preventDefault();
    $("viewport").focus({ preventScroll: true });
    $("diagram").setPointerCapture(e.pointerId);
  });
  $("viewport").addEventListener("pointermove", (e) => {
    if (!gesture) return;
    const p = canvasPoint(e);
    if (gesture.kind === "pan") {
      $("viewport").scrollLeft = gesture.left - (e.clientX - gesture.x);
      $("viewport").scrollTop = gesture.top - (e.clientY - gesture.y);
      return;
    }
    if (gesture.kind === "move") {
      let dx = p.x - gesture.start.x,
        dy = p.y - gesture.start.y;
      gesture.moved = gesture.moved || Math.abs(dx) + Math.abs(dy) > 2;
      if (!gesture.moved) return;
      const minX = Math.min(...gesture.positions.map((p) => p.x)),
        minY = Math.min(...gesture.positions.map((p) => p.y));
      guides = [];
      if ($("snap-toggle").checked && !e.altKey) {
        const lead = gesture.positions[0],
          others = model.shapes.filter((s) => !selection.has(s.id));
        let bestX = 8 / zoom,
          bestY = 8 / zoom,
          snapX = null,
          snapY = null;
        for (const other of others) {
          const q = position(other),
            cx = q.x + q.w / 2,
            cy = q.y + q.h / 2,
            diffX = cx - (lead.x + dx + lead.w / 2),
            diffY = cy - (lead.y + dy + lead.h / 2);
          if (Math.abs(diffX) < bestX) {
            bestX = Math.abs(diffX);
            snapX = { delta: diffX, value: cx };
          }
          if (Math.abs(diffY) < bestY) {
            bestY = Math.abs(diffY);
            snapY = { delta: diffY, value: cy };
          }
        }
        if (snapX) {
          dx += snapX.delta;
          guides.push({
            x1: snapX.value,
            y1: 0,
            x2: snapX.value,
            y2: extents().contentH,
          });
        } else dx = Math.round((lead.x + dx) / 10) * 10 - lead.x;
        if (snapY) {
          dy += snapY.delta;
          guides.push({
            x1: 0,
            y1: snapY.value,
            x2: extents().contentW,
            y2: snapY.value,
          });
        } else dy = Math.round((lead.y + dy) / 10) * 10 - lead.y;
      }
      dx = Math.max(-minX, dx);
      dy = Math.max(-minY, dy);
      gesture.delta = { x: dx, y: dy };
      for (const start of gesture.positions) {
        const s = model.shapes.find((s) => s.id === start.id);
        place(s, start.x + dx, start.y + dy);
      }
      // Move manual routes only when both endpoints move as a group.
      const original = JSON.parse(gesture.before);
      for (const c of model.connections)
        if (selection.has(c.from) && selection.has(c.to)) {
          const old = original.connections.find((v) => v.id === c.id);
          c.points = old.points.map((q) => ({
            x: Math.max(0, q.x + dx),
            y: Math.max(0, q.y + dy),
          }));
        }
    } else if (gesture.kind === "resize") {
      const s = model.shapes.find((s) => s.id === gesture.id);
      s.width = Math.round(
        Math.max(40, Math.min(1200, gesture.w + p.x - gesture.start.x)),
      );
      s.height = Math.round(
        Math.max(28, Math.min(1200, gesture.h + p.y - gesture.start.y)),
      );
    } else if (gesture.kind === "route") {
      const c = model.connections.find((c) => c.id === gesture.id);
      c.points[gesture.index] = {
        x: Math.max(0, Math.round(p.x)),
        y: Math.max(0, Math.round(p.y)),
      };
    } else if (gesture.kind === "connect") gesture.current = p;
    schedule();
  });
  $("viewport").addEventListener("pointerup", (e) => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    guides = [];
    if (g.kind === "connect") {
      const hit = document.elementFromPoint(e.clientX, e.clientY),
        node = hit?.closest("[data-node]"),
        key = node?.getAttribute("data-node"),
        s = model.shapes.find((s) => s.id === key);
      if (s && s.id !== g.from)
        addConnection(
          g.from,
          s.id,
          g.port,
          hit.getAttribute("data-port") || nearestPort(s, canvasPoint(e)),
        );
    } else if (g.before) {
      if (g.kind === "resize")
        ensureTextFit(model.shapes.find((s) => s.id === g.id));
      finish(g.before);
      syncInspector();
    }
    if ($("diagram").hasPointerCapture(e.pointerId))
      $("diagram").releasePointerCapture(e.pointerId);
    schedule();
  });
  $("viewport").addEventListener("pointercancel", cancelGesture);
  $("diagram").addEventListener("dblclick", (e) => {
    const node = e.target.closest("[data-node]"),
      grid = e.target.closest("[data-grid]"),
      conn = e.target.closest("[data-conn]");
    if (node) {
      const s = model.shapes.find(
        (s) => s.id === node.getAttribute("data-node"),
      );
      editText("Edit shape text", s.text, (value) =>
        mutate(() => {
          s.text = value;
          ensureTextFit(s);
        }),
      );
    } else if (grid)
      editGrid(grid.getAttribute("data-grid"), grid.getAttribute("data-id"));
    else if (conn) {
      const c = model.connections.find(
        (c) => c.id === conn.getAttribute("data-conn"),
      );
      editText(
        "Edit connector label",
        c.label,
        (value) => mutate(() => (c.label = value)),
        500,
      );
    }
  });
  $("diagram").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const node = e.target.closest("[data-node]"),
      conn = e.target.closest("[data-conn]"),
      grid = e.target.closest("[data-grid]");
    if (node) {
      const key = node.getAttribute("data-node");
      if (
        tool === "connect" &&
        model.shapes.find((s) => s.id === key)?.type !== "text"
      ) {
        if (connectStart) {
          addConnection(connectStart, key);
          connectStart = null;
        } else {
          connectStart = key;
          toast("Now focus the destination shape and press Enter.");
        }
        schedule();
      } else selectNode(key, e.shiftKey);
      e.preventDefault();
    } else if (conn) {
      selection.clear();
      selectedConnection = conn.getAttribute("data-conn");
      syncInspector();
      schedule();
      e.preventDefault();
    } else if (grid) {
      editGrid(grid.getAttribute("data-grid"), grid.getAttribute("data-id"));
      e.preventDefault();
    }
  });
  function setZoom(value, client) {
    const vp = $("viewport"),
      r = vp.getBoundingClientRect(),
      old = zoom;
    zoom = Math.max(0.15, Math.min(3, value));
    const x = client ? client.x - r.left : vp.clientWidth / 2,
      y = client ? client.y - r.top : vp.clientHeight / 2;
    const worldX = (vp.scrollLeft + x - 24) / old,
      worldY = (vp.scrollTop + y - 24) / old;
    render();
    vp.scrollLeft = worldX * zoom - x + 24;
    vp.scrollTop = worldY * zoom - y + 24;
    $("zoom-label").textContent = `${Math.round(zoom * 100)}%`;
  }
  function fit() {
    const b = extents();
    setZoom(
      Math.min(
        ($("viewport").clientWidth - 48) / b.width,
        ($("viewport").clientHeight - 48) / b.height,
        1,
      ),
    );
    $("viewport").scrollLeft = 0;
    $("viewport").scrollTop = 0;
  }
  $("viewport").addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(zoom * Math.exp(-e.deltaY * 0.002), {
          x: e.clientX,
          y: e.clientY,
        });
      }
    },
    { passive: false },
  );
  function filename() {
    return (
      (model.document.reference || model.document.title || "swimlane-diagram")
        .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 100) || "swimlane-diagram"
    );
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = html("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function saveJSON() {
    download(
      new Blob([JSON.stringify(model, null, 2)], { type: "application/json" }),
      filename() + ".json",
    );
    savedSnapshot = snapshot();
    persist();
    toast("Diagram JSON downloaded.");
  }
  async function openFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024)
      return toast("Choose a JSON file smaller than 10 MB.");
    let next;
    try {
      next = normalize(JSON.parse(await file.text()));
    } catch (e) {
      toast(
        `Cannot open diagram: ${e.message} Your current diagram is unchanged.`,
      );
      return;
    }
    const apply = () => {
      cancelGesture();
      const before = remember();
      model = next;
      selection.clear();
      selectedConnection = null;
      finish(before);
      savedSnapshot = snapshot();
      persist();
      syncDocument();
      syncInspector();
      fit();
      toast("Diagram opened. Undo restores the previous diagram.");
    };
    if (dirty())
      dialog(
        "Open another diagram?",
        (body) =>
          body.append(
            html(
              "p",
              {},
              "Your current diagram has changes since its last JSON save. Save a copy before opening another file. You can also undo the replacement.",
            ),
          ),
        [
          { label: "Cancel" },
          {
            label: "Save current & open",
            primary: true,
            run: () => {
              saveJSON();
              apply();
            },
          },
          { label: "Open without saving", run: apply },
        ],
      );
    else apply();
  }
  $("file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    openFile(file);
  });
  function cleanSVG() {
    render();
    const copy = $("diagram").cloneNode(true);
    copy.querySelectorAll(".editor-only").forEach((el) => el.remove());
    copy.querySelectorAll("[data-node]").forEach((el) => {
      if (
        model.shapes.find((s) => s.id === el.getAttribute("data-node"))
          ?.type === "text"
      ) {
        el.querySelector(".shape-outline")?.setAttribute(
          "data-export-text",
          "true",
        );
      }
    });
    copy
      .querySelectorAll("[tabindex]")
      .forEach((el) => el.removeAttribute("tabindex"));
    copy
      .querySelectorAll("[data-node],[data-conn],[data-grid]")
      .forEach((el) => {
        for (const attr of [...el.attributes])
          if (
            attr.name.startsWith("data-") ||
            ["role", "aria-label", "class"].includes(attr.name)
          )
            el.removeAttribute(attr.name);
      });
    // Selection color is editor state, not diagram content.
    copy.querySelectorAll(".shape-outline").forEach((el) => {
      el.setAttribute(
        "stroke",
        el.hasAttribute("data-export-text") ? "none" : "#36596b",
      );
      el.removeAttribute("class");
      el.removeAttribute("data-export-text");
    });
    copy
      .querySelectorAll('[stroke="#0284c7"]')
      .forEach((el) => el.setAttribute("stroke", "#526979"));
    copy
      .querySelectorAll('[marker-end="url(#arrow-selected)"]')
      .forEach((el) => {
        el.setAttribute("marker-end", "url(#arrow)");
        el.setAttribute("stroke-width", "1.8");
      });
    copy.removeAttribute("style");
    copy.removeAttribute("class");
    copy.setAttribute("xmlns", NS);
    return new XMLSerializer().serializeToString(copy);
  }
  function exportSVG() {
    try {
      download(
        new Blob([cleanSVG()], { type: "image/svg+xml;charset=utf-8" }),
        filename() + ".svg",
      );
      toast("SVG downloaded.");
    } catch (e) {
      toast("SVG export failed: " + e.message);
    }
  }
  async function exportPNG() {
    if (exportBusy) return;
    exportBusy = true;
    try {
      const xml = cleanSVG(),
        b = extents();
      let scale = Number($("export-scale").value);
      const maxSide = 16000,
        maxPixels = 60000000;
      scale = Math.min(
        scale,
        maxSide / b.width,
        maxSide / b.height,
        Math.sqrt(maxPixels / (b.width * b.height)),
      );
      if (scale < 0.1)
        throw Error("Diagram is too large for PNG. Use SVG or PDF instead.");
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(b.width * scale);
      canvas.height = Math.ceil(b.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw Error("Canvas is unavailable.");
      const image = new Image(),
        url = URL.createObjectURL(
          new Blob([xml], { type: "image/svg+xml;charset=utf-8" }),
        );
      try {
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(Error("Could not render diagram."));
          image.src = url;
        });
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      } finally {
        URL.revokeObjectURL(url);
      }
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob)
        throw Error("Browser could not create the PNG. Use SVG instead.");
      download(blob, filename() + ".png");
      toast(`PNG downloaded (${canvas.width} × ${canvas.height} pixels).`);
    } catch (e) {
      toast("PNG export failed: " + e.message);
    } finally {
      exportBusy = false;
    }
  }
  function exportPDF() {
    try {
      const xml = cleanSVG(),
        win = window.open("", "_blank");
      if (!win)
        return toast(
          "Allow this app to open a print tab, then try PDF / Print again.",
        );
      const doc = win.document;
      doc.open();
      doc.write(
        '<!doctype html><html><head><meta charset="utf-8"><title>Diagram PDF</title><style>@page{size:landscape;margin:10mm}body{margin:0;background:#eef2f6;font-family:Arial}nav{padding:14px;display:flex;gap:12px;align-items:center}button{padding:10px;cursor:pointer}svg{display:block;background:white;width:100%;height:auto;max-height:90vh}@media print{nav{display:none}body{background:white}svg{width:100%;height:auto;max-height:calc(100vh - 22mm);break-inside:avoid}}</style></head><body><nav><button id="print">Print / Save as PDF</button><span>Choose Save as PDF, landscape, and fit to page.</span></nav><div id="print-diagram"></div></body></html>',
      );
      doc.close();
      doc.title = filename();
      const parsed = new DOMParser().parseFromString(xml, "image/svg+xml");
      doc
        .getElementById("print-diagram")
        .append(doc.importNode(parsed.documentElement, true));
      doc.getElementById("print").onclick = () => win.print();
      setTimeout(() => {
        if (!win.closed) win.print();
      }, 300);
      toast("Print view opened. Choose Save as PDF in the print dialog.");
    } catch (e) {
      toast("Could not open PDF print view: " + e.message);
    }
  }
  function newDiagram() {
    const apply = () => {
      const before = remember();
      cancelGesture();
      model = initial();
      selection.clear();
      selectedConnection = null;
      finish(before);
      changed();
      fit();
    };
    dialog(
      "Create a new diagram?",
      (body) =>
        body.append(
          html(
            "p",
            {},
            "Save your current diagram first if you want a portable copy. Undo can also restore it after creating a new diagram.",
          ),
        ),
      [
        { label: "Cancel" },
        {
          label: "Save & create new",
          primary: true,
          run: () => {
            saveJSON();
            apply();
          },
        },
        { label: "Create new", run: apply },
      ],
    );
  }
  const actions = {
    new: newDiagram,
    open: () => $("file-input").click(),
    save: saveJSON,
    undo,
    redo,
    stage: () => {
      if (model.stages.length >= 60) return toast("Maximum 60 stages.");
      mutate(() =>
        model.stages.push({
          id: uid("stage"),
          title: `Stage ${model.stages.length + 1}`,
        }),
      );
    },
    lane: () => {
      if (model.lanes.length >= 100)
        return toast("Maximum 100 responsibilities.");
      mutate(() =>
        model.lanes.push({
          id: uid("lane"),
          title: `Responsibility ${model.lanes.length + 1}`,
        }),
      );
    },
    png: exportPNG,
    svg: exportSVG,
    pdf: exportPDF,
    duplicate: duplicateSelection,
    delete: deleteSelection,
    "zoom-in": () => setZoom(zoom * 1.2),
    "zoom-out": () => setZoom(zoom / 1.2),
    "reset-zoom": () => setZoom(1),
    fit,
  };
  document
    .querySelectorAll("[data-action]")
    .forEach((el) =>
      el.addEventListener("click", () => actions[el.dataset.action]()),
    );
  document
    .querySelectorAll("[data-add]")
    .forEach((el) =>
      el.addEventListener("click", () => addShape(el.dataset.add)),
    );
  document
    .querySelectorAll("[data-tool]")
    .forEach((el) =>
      el.addEventListener("click", () => setTool(el.dataset.tool)),
    );
  document
    .querySelectorAll("[data-align]")
    .forEach((el) =>
      el.addEventListener("click", () => align(el.dataset.align)),
    );
  for (const [key, prop] of [
    ["doc-title", "title"],
    ["doc-reference", "reference"],
    ["doc-revision", "revision"],
    ["doc-date", "date"],
  ])
    $(key).addEventListener("change", () =>
      mutate(() => (model.document[prop] = $(key).value)),
    );
  $("doc-footer").addEventListener("change", () =>
    mutate(() => (model.document.showFooter = $("doc-footer").checked)),
  );
  for (const [key, prop, min, max] of [
    ["col-width", "colWidth", 150, 800],
    ["row-height", "rowHeight", 100, 800],
  ])
    $(key).addEventListener("change", () => {
      try {
        const value = num($(key).value, min, max, key);
        mutate(() => {
          const ratio = value / model[prop];
          for (const s of model.shapes)
            s[prop === "colWidth" ? "x" : "y"] *= ratio;
          for (const c of model.connections)
            for (const p of c.points)
              p[prop === "colWidth" ? "x" : "y"] *= ratio;
          model[prop] = value;
        });
      } catch (e) {
        toast(e.message);
        $(key).value = model[prop];
      }
    });
  $("help-button").onclick = () => $("help-dialog").showModal();
  $("close-help").onclick = () => $("help-dialog").close();
  document.addEventListener("keydown", (e) => {
    const editing = e.target.matches(
      'input,textarea,select,[contenteditable="true"]',
    );
    if ($("editor-dialog").open || $("help-dialog").open) return;
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey,
      key = e.key.toLowerCase();
    if (mod && ["z", "y", "s", "o", "d", "a", "c", "v"].includes(key)) {
      e.preventDefault();
      if (key === "z") return e.shiftKey ? redo() : undo();
      if (key === "y") return redo();
      if (key === "s") return saveJSON();
      if (key === "o") return $("file-input").click();
      if (key === "d") return duplicateSelection();
      if (key === "a") {
        selection = new Set(model.shapes.map((s) => s.id));
        selectedConnection = null;
        syncInspector();
        schedule();
        return;
      }
      if (key === "c") {
        clipboard = {
          shapes: clone(model.shapes.filter((s) => selection.has(s.id))),
          connections: clone(
            model.connections.filter(
              (c) => selection.has(c.from) && selection.has(c.to),
            ),
          ),
        };
        toast("Selection copied inside the app.");
        return;
      }
      if (key === "v" && clipboard?.shapes.length) {
        if (
          model.shapes.length + clipboard.shapes.length > 500 ||
          model.connections.length + clipboard.connections.length > 1000
        )
          return toast("Pasting would exceed the diagram size limits.");
        mutate(() => {
          const ids = new Map(
            clipboard.shapes.map((s) => [s.id, uid("shape")]),
          );
          const copies = clipboard.shapes.map((s) => {
            const n = clone(s);
            n.id = ids.get(s.id);
            if (!model.stages.some((v) => v.id === n.stageId))
              n.stageId = model.stages[0].id;
            if (!model.lanes.some((v) => v.id === n.laneId))
              n.laneId = model.lanes[0].id;
            n.x += 24;
            n.y += 24;
            n.z = Math.max(0, ...model.shapes.map((s) => s.z)) + 1;
            return n;
          });
          model.shapes.push(...copies);
          model.connections.push(
            ...clipboard.connections.map((c) => ({
              ...clone(c),
              id: uid("conn"),
              from: ids.get(c.from),
              to: ids.get(c.to),
              points: c.points.map((p) => ({ x: p.x + 24, y: p.y + 24 })),
            })),
          );
          selection = new Set(copies.map((s) => s.id));
          selectedConnection = null;
        });
        return;
      }
      return;
    }
    if (key === "escape") {
      cancelGesture();
      selection.clear();
      selectedConnection = null;
      syncInspector();
      schedule();
      return;
    }
    if (e.code === "Space") {
      space = true;
      e.preventDefault();
      schedule();
      return;
    }
    if (["delete", "backspace"].includes(key)) {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (
      ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key) &&
      selection.size
    ) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1,
        dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0,
        dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
      mutate(() => {
        const nodes = model.shapes.filter((s) => selection.has(s.id)),
          positions = nodes.map((s) => ({ s, ...position(s) })),
          minX = Math.min(...positions.map((p) => p.x)),
          minY = Math.min(...positions.map((p) => p.y)),
          tx = Math.max(dx, -minX),
          ty = Math.max(dy, -minY);
        positions.forEach((p) => place(p.s, p.x + tx, p.y + ty));
        for (const c of model.connections)
          if (selection.has(c.from) && selection.has(c.to))
            c.points = c.points.map((p) => ({
              x: Math.max(0, p.x + tx),
              y: Math.max(0, p.y + ty),
            }));
      });
      return;
    }
    if (!mod) {
      if (key === "v") setTool("select");
      if (key === "c") setTool("connect");
      if (key === "h") setTool("pan");
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      space = false;
      schedule();
    }
  });
  window.addEventListener("blur", () => {
    space = false;
    if (gesture) cancelGesture();
  });
  window.addEventListener("beforeunload", (e) => {
    if (gesture?.before) cancelGesture();
    persist();
    if (dirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persist();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === STORE && e.newValue) {
      tabConflict = true;
      status();
      dialog(
        "Another tab updated this diagram",
        (body) =>
          body.append(
            html(
              "p",
              {},
              "Automatic recovery is paused here to avoid overwriting changes from another tab. Save this tab as JSON, then choose whether to keep editing here or load the other tab’s recovery copy.",
            ),
          ),
        [
          { label: "Keep recovery paused" },
          { label: "Save this tab as JSON", run: saveJSON },
          {
            label: "Load other tab",
            run: () => {
              try {
                const state = JSON.parse(localStorage.getItem(STORE)),
                  next = normalize(state.model);
                mutate(() => {
                  model = next;
                  selection.clear();
                  selectedConnection = null;
                });
                savedSnapshot =
                  typeof state.savedSnapshot === "string"
                    ? state.savedSnapshot
                    : "";
                tabConflict = false;
                persist();
                fit();
              } catch (e) {
                toast("Could not load recovery: " + e.message);
              }
            },
          },
          {
            label: "Use this tab",
            primary: true,
            run: () => {
              tabConflict = false;
              persist();
            },
          },
        ],
      );
    }
  });
  model = initial();
  savedSnapshot = snapshot();
  try {
    const stored = localStorage.getItem(STORE);
    if (stored) {
      const data = JSON.parse(stored);
      model = normalize(data.model);
      savedSnapshot =
        typeof data.savedSnapshot === "string" ? data.savedSnapshot : "";
      toast("Previous diagram recovered from this browser.");
    }
  } catch {
    toast(
      "Recovery was unavailable or invalid. Open a saved JSON file to restore your diagram.",
    );
    recoveryWorking = false;
  }
  syncDocument();
  syncInspector();
  render();
  requestAnimationFrame(fit);
  // Public, read-only diagnostics are useful when reporting file compatibility problems.
  window.SwimlaneBuilder = Object.freeze({
    version: "2.0.0",
    getDiagram: () => clone(model),
    validateDiagram: (raw) => clone(normalize(raw)),
  });
})();
