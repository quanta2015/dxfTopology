import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import DxfParser from "dxf-parser";
import "./Canvas.css";

/** ====== 基础工具 ====== */
function rad(deg) {
  return (deg * Math.PI) / 180;
}

function isBigFillEntityType(t) {
  return t === "HATCH" || t === "SOLID" || t === "TRACE" || t === "WIPEOUT";
}

function expandBBox(b, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return b;
  if (!b) return { minX: x, minY: y, maxX: x, maxY: y };
  return {
    minX: Math.min(b.minX, x),
    minY: Math.min(b.minY, y),
    maxX: Math.max(b.maxX, x),
    maxY: Math.max(b.maxY, y)
  };
}

function toXY(p) {
  if (!p) return null;
  if (Array.isArray(p)) {
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return null;
  }
  const x = Number(p.x ?? p.X);
  const y = Number(p.y ?? p.Y);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return null;
}

function getLinePoints(e) {
  let s = toXY(e.start) || toXY(e?.startPoint) || toXY(e?.start_point);
  let t = toXY(e.end) || toXY(e?.endPoint) || toXY(e?.end_point);

  if ((!s || !t) && e.vertices && e.vertices.length > 1) {
    s = toXY(e.vertices[0]);
    t = toXY(e.vertices[1]);
  }
  if (!s || !t) return null;
  return { s, t };
}

function getCenter(e) {
  return toXY(e.center) || toXY(e?.position) || toXY(e?.insert) || toXY(e?.point) || null;
}

function getVertices(e) {
  const vs = e.vertices || e.points || e?.polylineVertices || [];
  const out = [];
  for (const v of vs) {
    const p = toXY(v) || toXY(v?.point) || toXY(v?.vertex) || null;
    if (p) {
      if (v?.bulge !== undefined) p.bulge = v.bulge;
      if (v?.b !== undefined) p.b = v.b;
      out.push(p);
    }
  }
  return out;
}

/** 计算两点间的凸度圆弧路径 */
function drawBulge(ctx, p1, p2, bulge) {
  if (bulge === 0) {
    ctx.lineTo(p2.x, p2.y);
    return;
  }
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return;

  const radius = (len * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const absBulge = Math.abs(bulge);
  const sign = bulge > 0 ? 1 : -1;

  const angle = Math.atan2(dy, dx);
  const dist = (len / 2) * ((1 - absBulge * absBulge) / (2 * absBulge));

  const cx = p1.x + dx / 2 - dist * Math.sin(angle) * sign;
  const cy = p1.y + dy / 2 + dist * Math.cos(angle) * sign;

  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
  const endAngle = Math.atan2(p2.y - cy, p2.x - cx);

  const counterClockwise = bulge > 0;
  // 注意：Canvas Y轴翻转 scaling 可能会影响 arc 的视觉方向，但数学逻辑通常是自洽的
  ctx.arc(cx, cy, radius, startAngle, endAngle, !counterClockwise);
}

/** ====== 辅助：生成斜线填充纹理 ====== */
const hatchPatternCache = new Map();
function getDiagonalPattern(ctx, spacing = 8, color = "#333333") {
  const key = `${spacing}-${color}`;
  if (hatchPatternCache.has(key)) return hatchPatternCache.get(key);

  const canvas = document.createElement("canvas");
  canvas.width = spacing;
  canvas.height = spacing;
  const c = canvas.getContext("2d");

  c.beginPath();
  c.strokeStyle = color;
  c.lineWidth = 1;
  c.moveTo(0, spacing);
  c.lineTo(spacing, 0);
  c.stroke();

  const pattern = ctx.createPattern(canvas, "repeat");
  hatchPatternCache.set(key, pattern);
  return pattern;
}

/** ====== 绘制基础实体 ====== */
/** ====== 绘制基础实体（样式修正版） ====== */
function drawPrimitiveEntity(ctx, e) {
  if (!e || !e.type) return;
  const t = e.type;

  // 开启路径
  ctx.beginPath();

  // 1. 线条 (LINE)
  if (t === "LINE") {
    const pts = getLinePoints(e);
    if (!pts) return;
    ctx.moveTo(pts.s.x, pts.s.y);
    ctx.lineTo(pts.t.x, pts.t.y);
    ctx.stroke();
  }
  // 2. 多段线 (POLYLINE / LWPOLYLINE)
  else if (t === "LWPOLYLINE" || t === "POLYLINE") {
    const vs = getVertices(e);
    if (vs.length < 2) return;
    ctx.moveTo(vs[0].x, vs[0].y);
    for (let i = 0; i < vs.length - 1; i++) {
      const p1 = vs[i];
      const p2 = vs[i + 1];
      const bulge = p1.bulge || p1.b || 0;
      drawBulge(ctx, p1, p2, bulge);
    }
    // 处理闭合
    if (e.shape || e.closed || e.flags === 1) {
      const last = vs[vs.length - 1];
      const first = vs[0];
      const bulge = last.bulge || last.b || 0;
      drawBulge(ctx, last, first, bulge);
      ctx.closePath();
    }
    ctx.stroke();
  }
  // 3. 圆 (CIRCLE)
  else if (t === "CIRCLE") {
    const c = getCenter(e);
    const r = Number(e.radius || 0);
    if (!c) return;
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 4. 圆弧 (ARC)
  else if (t === "ARC") {
    const c = getCenter(e);
    const r = Number(e.radius || 0);
    if (!c) return;
    ctx.arc(c.x, c.y, r, rad(e.startAngle || 0), rad(e.endAngle || 0));
    ctx.stroke();
  }
  // 5. 椭圆 (ELLIPSE)
  else if (t === "ELLIPSE") {
    const c = getCenter(e);
    const mj = toXY(e.majorAxisEndPoint);
    const ratio = Number(e.axisRatio ?? 1);
    if (!c || !mj) return;
    const rx = Math.sqrt(mj.x * mj.x + mj.y * mj.y);
    const ry = rx * ratio;
    const rot = Math.atan2(mj.y, mj.x);
    try {
      ctx.ellipse(c.x, c.y, rx, ry, rot, Number(e.startAngle || 0), Number(e.endAngle || Math.PI * 2));
      ctx.stroke();
    } catch (err) {}
  }
  // 6. 样条曲线 (SPLINE)
  else if (t === "SPLINE") {
    const points = e.controlPoints || e.points || [];
    if (points.length < 2) return;
    const p0 = toXY(points[0]);
    if (p0) ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < points.length; i++) {
      const p = toXY(points[i]);
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  // 7. 实体填充 (SOLID / TRACE / WIPEOUT)
  else if (t === "SOLID" || t === "TRACE" || t === "WIPEOUT") {
    const points = e.points || e.vertices || [];
    if (points.length >= 3) {
      const p0 = toXY(points[0]);
      if (p0) {
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < points.length; i++) {
          const p = toXY(points[i]);
          if (p) ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();

        // 关键修改：使用半透明灰色，防止遮挡
        ctx.fillStyle = "rgba(100, 100, 100, 0.3)";
        ctx.fill();

        // 关键修改：绘制边框，以便看清形状
        ctx.strokeStyle = "#555";
        ctx.stroke();
      }
    }
  }
  // 8. 图案填充 (HATCH)
  else if (t === "HATCH") {
    const loops = e.boundaryLoops || [];
    let hasPoints = false;
    for (const loop of loops) {
      const vs = loop.vertices;
      // 仅处理带有顶点的简单 Loop，忽略复杂的 Edge 定义以防报错
      if (vs && vs.length > 0) {
        hasPoints = true;
        const p0 = toXY(vs[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 0; i < vs.length - 1; i++) {
          const p1 = toXY(vs[i]);
          const p2 = toXY(vs[i + 1]);
          const bulge = vs[i].bulge || 0;
          drawBulge(ctx, p1, p2, bulge);
        }
        const last = toXY(vs[vs.length - 1]);
        const first = toXY(vs[0]);
        const lastBulge = vs[vs.length - 1].bulge || 0;
        drawBulge(ctx, last, first, lastBulge);
      }
    }

    if (hasPoints) {
      ctx.closePath();

      // 关键修改：HATCH 统一使用非常淡的半透明色
      // 避免 SOLID 类型的 Hatch 变成一大坨黑色
      ctx.fillStyle = "rgba(0, 0, 255, 0.1)"; // 淡蓝色半透明
      ctx.fill();

      // 必须描边，否则淡色看不清
      ctx.lineWidth = 1 / (window.currentScale || 1); // 尝试保持线宽
      ctx.strokeStyle = "#444";
      ctx.stroke();
    }
  } else if (t === "ATTRIB") {
    const p = toXY(e.position) || toXY(e.insert);
    const text = String(e.text ?? e.string ?? "");
    if (!p || !text) return;
    const h = Number(e.textHeight || 10);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(rad(Number(e.rotation || 0)));
    ctx.scale(1, -1); // 你整体坐标系已经 scale(fit,-fit)，这里如果文字倒着就去掉这一行
    ctx.font = `${h}px sans-serif`;
    ctx.fillStyle = "#111";
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

/** ====== 解析 Block Key ====== */
function resolveBlockKey(insert, blockInfoMap) {
  if (!insert || !blockInfoMap) return null;
  const candidates = [insert.name, insert.block, insert.blockName, insert.block_id, insert.blockId, insert.blockHandle]
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v).trim());

  for (const c of candidates) {
    if (blockInfoMap.has(c)) return c;
  }
  // 大小写模糊匹配
  if (candidates.length) {
    const lowerMap = new Map();
    for (const k of blockInfoMap.keys()) lowerMap.set(String(k).toLowerCase(), k);
    for (const c of candidates) {
      const hit = lowerMap.get(c.toLowerCase());
      if (hit) return hit;
    }
  }
  return null;
}

/** * ====== 统一的 BBox 计算逻辑 ======
 * 将所有 BBox 计算收敛到这一个函数，避免左右逻辑不一致
 */
function calculateBBox(entities, blockInfoMap, depth, visitedBlocks) {
  if (!entities?.length) return null;
  if (depth <= 0) return null;

  let b = null;
  const addPoint = (p) => {
    if (!p) return;
    b = expandBBox(b, p.x, p.y);
  };

  for (const e of entities) {
    if (!e || !e.type) continue;

    // 过滤掉不可见的实体 (可选)
    if (e.visible === false) continue;

    const t = e.type;

    if (t === "INSERT") {
      const childKey = resolveBlockKey(e, blockInfoMap);
      if (!childKey || visitedBlocks.has(childKey)) continue;

      const info = blockInfoMap.get(childKey);
      const childEnts = info?.entities || [];
      const bp = info?.basePoint || { x: 0, y: 0 };

      if (!childEnts.length) continue;

      visitedBlocks.add(childKey);
      const childBBox = calculateBBox(childEnts, blockInfoMap, depth - 1, visitedBlocks);
      visitedBlocks.delete(childKey);

      if (childBBox) {
        const pos = toXY(e.position) || toXY(e.insert) || { x: 0, y: 0 };
        const sx = e.scaleX ?? e.xScale ?? 1;
        const sy = e.scaleY ?? e.yScale ?? 1;
        const rot = Number(e.rotation || 0);
        const r = rad(rot);
        const cos = Math.cos(r);
        const sin = Math.sin(r);

        // 计算 Block BBox 的四个角在当前空间的投影
        // 关键：先减去 basePoint，再缩放旋转，再加 position
        const corners = [
          { x: childBBox.minX - bp.x, y: childBBox.minY - bp.y },
          { x: childBBox.minX - bp.x, y: childBBox.maxY - bp.y },
          { x: childBBox.maxX - bp.x, y: childBBox.minY - bp.y },
          { x: childBBox.maxX - bp.x, y: childBBox.maxY - bp.y }
        ];

        for (const p of corners) {
          const xs = p.x * sx;
          const ys = p.y * sy;
          const xr = cos * xs - sin * ys;
          const yr = sin * xs + cos * ys;
          addPoint({ x: xr + pos.x, y: yr + pos.y });
        }
      }
      continue;
    }

    // 处理基础图元
    if (t === "LINE") {
      const pts = getLinePoints(e);
      if (pts) {
        addPoint(pts.s);
        addPoint(pts.t);
      }
    } else if (t === "LWPOLYLINE" || t === "POLYLINE") {
      getVertices(e).forEach(addPoint);
    } else if (t === "CIRCLE" || t === "ARC") {
      const c = getCenter(e);
      const r = Number(e.radius || 0);
      if (c) {
        addPoint({ x: c.x - r, y: c.y - r });
        addPoint({ x: c.x + r, y: c.y + r });
      }
    } else if (t === "ELLIPSE") {
      const c = getCenter(e);
      const mj = toXY(e.majorAxisEndPoint);
      if (c && mj) {
        const r = Math.sqrt(mj.x * mj.x + mj.y * mj.y);
        addPoint({ x: c.x - r, y: c.y - r });
        addPoint({ x: c.x + r, y: c.y + r });
      }
    } else if (t === "SPLINE") {
      const points = e.controlPoints || e.points || [];
      points.forEach((p) => addPoint(toXY(p)));
    } else if (t === "SOLID" || t === "TRACE") {
      const points = e.points || e.vertices || [];
      points.forEach((p) => addPoint(toXY(p)));
    } else if (t === "HATCH") {
      // 简化处理 Hatch 边界
      const loops = e.boundaryLoops || [];
      for (const loop of loops) {
        if (loop.vertices) loop.vertices.forEach((v) => addPoint(toXY(v)));
      }
    }
  }
  return b;
}

/** * ====== 统一的绘制逻辑 ======
 * 将递归绘制收敛到这一个函数
 */
function renderEntities(ctx, entities, blockInfoMap, depth, visitedBlocks) {
  if (!entities || depth <= 0) return;

  for (const e of entities) {
    if (!e || !e.type) continue;
    if (e.visible === false) continue; // 遵守可见性

    if (e.type === "INSERT") {
      const childKey = resolveBlockKey(e, blockInfoMap);
      if (!childKey || visitedBlocks.has(childKey)) continue;

      const info = blockInfoMap.get(childKey);
      const childEnts = info?.entities || [];
      const bp = info?.basePoint || { x: 0, y: 0 };
      if (!childEnts.length) continue;

      const pos = toXY(e.position) || toXY(e.insert) || { x: 0, y: 0 };
      const sx = e.scaleX ?? e.xScale ?? 1;
      const sy = e.scaleY ?? e.yScale ?? 1;
      const rot = e.rotation || 0;

      ctx.save();
      // 1. 移动到插入点
      ctx.translate(pos.x, pos.y);
      // 2. 旋转
      ctx.rotate(rad(rot));
      // 3. 缩放
      ctx.scale(sx, sy);
      // 4. 抵消 Block 定义的基点偏移
      ctx.translate(-bp.x, -bp.y);

      visitedBlocks.add(childKey);
      renderEntities(ctx, childEnts, blockInfoMap, depth - 1, visitedBlocks);
      visitedBlocks.delete(childKey);

      ctx.restore();
      continue;
    }

    // if (e.type === "ATTDEF" || e.type === "ATTRIB") continue;
    if (e.type === "ATTDEF") continue;
    drawPrimitiveEntity(ctx, e);
  }
}

/** ====== 辅助：解析 INSERT 属性 ====== */
function parseInsertAttribMapFromRaw(dxfText) {
  const map = new Map();
  if (!dxfText) return map;

  const lines = dxfText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let i = 0;

  let curInsertHandle = null;
  let curInInsert = false;

  const readPair = () => {
    if (i + 1 >= lines.length) return null;
    const code = lines[i].trim();
    const val = (lines[i + 1] || "").trim();
    i += 2;
    return { code, val };
  };

  while (i < lines.length) {
    const pair = readPair();
    if (!pair) break;

    const { code, val } = pair;

    if (code === "0" && val === "INSERT") {
      // 进入一个新的 INSERT，接下来直到下一个 0 为止找 handle(5)
      curInsertHandle = null;
      curInInsert = true;

      // 向前看 INSERT 自己的字段
      let j = i;
      while (j + 1 < lines.length && lines[j].trim() !== "0") {
        const c = lines[j].trim();
        const v = (lines[j + 1] || "").trim();
        if (c === "5") curInsertHandle = v;
        j += 2;
      }
      if (curInsertHandle && !map.has(curInsertHandle)) map.set(curInsertHandle, []);
      continue;
    }

    if (code === "0" && val === "ATTRIB" && curInsertHandle) {
      // 解析一个 ATTRIB 的常用字段：2(tag) 1(text) 10/20(x/y) 40(height) 50(rot)
      let tag = null,
        text = null;
      let x = null,
        y = null,
        h = null,
        rot = null;

      let j = i;
      while (j + 1 < lines.length && lines[j].trim() !== "0") {
        const c = lines[j].trim();
        const v = (lines[j + 1] || "").trim();

        if (c === "2") tag = v;
        if (c === "1") text = v;

        if (c === "10") x = Number(v);
        if (c === "20") y = Number(v);

        if (c === "40") h = Number(v);
        if (c === "50") rot = Number(v);

        j += 2;
      }

      map.get(curInsertHandle).push({
        tag,
        text,
        position: Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null,
        textHeight: Number.isFinite(h) ? h : null,
        rotation: Number.isFinite(rot) ? rot : null
      });

      continue;
    }

    if (code === "0" && (val === "SEQEND" || val === "ENDSEC")) {
      curInsertHandle = null;
      curInInsert = false;
      continue;
    }
  }

  return map;
}

function getInsertHandle(e) {
  return e?.handle || e?.id || e?.dxf?.handle;
}

function injectAttribEntitiesIntoDxf(dxf, attribMap) {
  if (!dxf?.entities?.length || !attribMap) return dxf;

  const extra = [];

  for (const e of dxf.entities) {
    if (!e || e.type !== "INSERT") continue;

    const handle = getInsertHandle(e);
    if (!handle) continue;

    const attrs = attribMap.get(handle);
    if (!attrs?.length) continue;

    const insertPos = toXY(e.position) || toXY(e.insert) || { x: 0, y: 0 };
    const insertRot = Number(e.rotation || 0);

    for (const a of attrs) {
      // ATTRIB 自己若带 position 用它，否则用 INSERT position
      const p = toXY(a.position) || insertPos;

      // 做成一个“可被你现有 drawPrimitiveEntity 识别”的实体结构
      extra.push({
        type: "ATTRIB",
        // 文字字段兼容（你 draw 里可用 e.text / e.string）
        text: a.text ?? "",
        tag: a.tag ?? "",
        // 位置字段兼容
        position: { x: p.x, y: p.y },
        // 高度/旋转（ATTRIB 没有就用 INSERT 的）
        textHeight: Number.isFinite(a.textHeight) ? a.textHeight : 10,
        rotation: Number.isFinite(a.rotation) ? a.rotation : insertRot,
        // 让它跟 INSERT 一样过滤纸空间/可见性
        inPaperSpace: e.inPaperSpace,
        visible: e.visible
      });
    }
  }

  // 返回一个新对象，避免直接改 parsed 引用（也可以直接 dxf.entities.push(...extra)）
  return {
    ...dxf,
    entities: [...dxf.entities, ...extra]
  };
}

/** ====== 主组件 ====== */
export default function CanvasViewer() {
  const mainCanvasRef = useRef(null);
  const listCanvasRef = useRef(null);
  const listWrapRef = useRef(null);

  const [err, setErr] = useState("");
  const [dxfText, setDxfText] = useState("");
  const [page, setPage] = useState(0);

  const loadDemo = useCallback(async () => {
    setErr("");
    try {
      const res = await fetch("/demo1.dxf");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDxfText(await res.text());
    } catch (e) {
      setErr(`加载失败：${e.message}`);
    }
  }, []);

  useEffect(() => {
    loadDemo();
  }, [loadDemo]);

  const parsed = useMemo(() => {
    if (!dxfText) return null;
    try {
      const parser = new DxfParser();
      return parser.parseSync(dxfText);
    } catch {
      return null;
    }
  }, [dxfText]);

  const attribMap = useMemo(() => parseInsertAttribMapFromRaw(dxfText), [dxfText]);

  const parsedWithAttrib = useMemo(() => {
    if (!parsed) return null;
    return injectAttribEntitiesIntoDxf(parsed, attribMap);
  }, [parsed, attribMap]);

  const blockInfoMap = useMemo(() => {
    const m = new Map();
    const blocks = parsedWithAttrib?.blocks || {};
    for (const [k, blk] of Object.entries(blocks)) {
      const ents = blk?.entities || blk || [];
      const basePoint = toXY(blk?.basePoint) || toXY(blk?.position) || { x: 0, y: 0 };
      m.set(k, { entities: Array.isArray(ents) ? ents : [], basePoint });
    }
    return m;
  }, [parsedWithAttrib]);

  const inserts = useMemo(() => {
    const ents = parsed?.entities || [];
    const uniqueInsertMap = new Map();
    for (const e of ents) {
      if (!e || e.type !== "INSERT") continue;
      const handle = getInsertHandle(e);
      const attrs = handle ? attribMap.get(handle) : null;
      let actualName = null;
      if (attrs?.length) {
        const a = attrs.find((x) => x.tag === "A" && x.text);
        if (a) actualName = a.text;
      }
      const resolvedKey = resolveBlockKey(e, blockInfoMap);
      if (!resolvedKey) continue;

      actualName = actualName || resolvedKey;
      uniqueInsertMap.set(actualName, {
        actualName,
        blockKey: resolvedKey
      });
    }
    return Array.from(uniqueInsertMap.values());
  }, [parsed, attribMap, blockInfoMap]);

  /** ====== 左侧：绘制整张 DXF (已修正) ====== */
  useEffect(() => {
    const canvas = mainCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !parsedWithAttrib) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 关键修正 1: 过滤掉 Paper Space (布局空间) 的实体
    // 布局空间实体通常会导致 BBox 计算涵盖从 (0,0) 到 (100000, 100000) 的巨大范围
    const allEnts = parsedWithAttrib.entities || [];
    const modelEnts = allEnts.filter((e) => {
      // 如果 dxf-parser 明确标记了 inPaperSpace，则过滤
      if (e.inPaperSpace === true) return false;
      // 有些 parser 版本放在 ownerHandle 指向 *Paper_Space，这里做简化 heuristic
      // 如果坐标特别小且靠近 0,0 而其他实体很大，可能需要更复杂的逻辑，
      // 但通常 inPaperSpace 足够，或者过滤掉 VIEWPORT 实体
      if (e.type === "VIEWPORT") return false;
      return true;
    });

    if (modelEnts.length === 0) {
      ctx.fillText("无模型空间数据", 20, 30);
      return;
    }

    // 关键修正 2: 使用统一的 BBox 计算逻辑
    const b = calculateBBox(modelEnts, blockInfoMap, 14, new Set());

    if (!b || (b.minX === b.maxX && b.minY === b.maxY)) {
      ctx.fillText("无法计算边界 (BBox Empty)", 20, 30);
      return;
    }

    const pad = 20;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const availW = canvas.width - pad * 2;
    const availH = canvas.height - pad * 2;
    const fit = Math.min(availW / bw, availH / bh);

    window.currentScale = fit;

    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;

    ctx.save();

    // 变换坐标系：移动到中心，翻转 Y 轴 (DXF Y-Up -> Canvas Y-Down)
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(fit, -fit);
    ctx.translate(-cx, -cy);

    ctx.lineWidth = 1 / fit; // 保持线宽为 1px
    ctx.strokeStyle = "#333";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 关键修正 3: 使用统一的绘制函数
    renderEntities(ctx, modelEnts, blockInfoMap, 14, new Set());

    ctx.restore();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#111";
    ctx.font = "12px sans-serif";
    ctx.fillText(`Ents: ${modelEnts.length} (Filtered from ${allEnts.length}) | Scale: ${fit.toFixed(4)}`, 12, 18);
  }, [parsed, blockInfoMap]);

  /** ====== 右侧：绘制列表 (复用统一逻辑) ====== */
  useEffect(() => {
    const canvas = listCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !parsed) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const COLS = 2;
    const cellW = 200,
      cellH = 170,
      pad = 10,
      headerH = 18;
    const availW = canvas.width - pad * 2;
    const perPage = Math.floor(availW / cellW) * Math.floor((canvas.height - pad * 2) / cellH);
    const safePerPage = Math.max(1, perPage);

    const start = page * safePerPage;
    const pageItems = inserts.slice(start, start + safePerPage);

    ctx.font = "12px sans-serif";

    pageItems.forEach((item, idx) => {
      const col = idx % Math.floor(availW / cellW);
      const row = Math.floor(idx / Math.floor(availW / cellW));
      const x0 = pad + col * cellW;
      const y0 = pad + row * cellH;

      // 绘制边框
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = "#ccc";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, cellW - 4, cellH - 4);
      ctx.fillStyle = "#000";
      ctx.fillText(item.actualName.slice(0, 20), x0 + 5, y0 + 14);

      // 获取 Block 实体
      const info = blockInfoMap.get(item.blockKey);
      const ents = info?.entities || [];

      // 计算单个 Block 的 BBox (不带 Insert 偏移，纯定义)
      const b = calculateBBox(ents, blockInfoMap, 10, new Set([item.blockKey]));
      if (!b) return;

      const innerW = cellW - 10,
        innerH = cellH - 24;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const bw = b.maxX - b.minX || 1;
      const bh = b.maxY - b.minY || 1;
      const fit = Math.min(innerW / bw, innerH / bh) * 0.9;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 + 2, y0 + 18, innerW, innerH);
      ctx.clip();

      ctx.translate(x0 + innerW / 2 + 2, y0 + 18 + innerH / 2);
      ctx.scale(fit, -fit);
      ctx.translate(-cx, -cy);

      ctx.lineWidth = 1 / fit;
      ctx.strokeStyle = "#333";

      // 复用统一绘制函数
      renderEntities(ctx, ents, blockInfoMap, 10, new Set([item.blockKey]));

      ctx.restore();
    });
  }, [inserts, blockInfoMap, page, parsed]);

  return (
    <div className="viewerRoot">
      {err && <div className="error">{err}</div>}
      <div className="leftPane">
        <canvas ref={mainCanvasRef} width={900} height={900} className="canvas" />
      </div>
      <div className="rightPane" ref={listWrapRef}>
        <div className="rightTopBar">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</button>
          <span> Page {page + 1} </span>
          <button onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
        <canvas ref={listCanvasRef} width={500} height={900} />
      </div>
    </div>
  );
}
