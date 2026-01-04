// 角度转弧度
export function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

// 创建空的包围盒
export function makeEmptyBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

// 用点扩展包围盒
export function expandBounds(b, p) {
  b.minX = Math.min(b.minX, p.x);
  b.minY = Math.min(b.minY, p.y);
  b.maxX = Math.max(b.maxX, p.x);
  b.maxY = Math.max(b.maxY, p.y);
}

// 从路径集合计算包围盒
export function boundsFromPaths(paths) {
  const b = makeEmptyBounds();
  for (const p of paths) {
    for (const pt of p.points) expandBounds(b, pt);
  }
  if (!isFinite(b.minX) || !isFinite(b.minY) || !isFinite(b.maxX) || !isFinite(b.maxY)) {
    return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  }
  return b;
}

// 创建单位矩阵
export function matIdentity() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

// 矩阵相乘（m1 * m2，先应用 m2，再应用 m1）
export function matMul(m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f
  };
}

// 创建平移矩阵
export function matTranslate(tx, ty) {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

// 创建缩放矩阵
export function matScale(sx, sy) {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

// 创建旋转矩阵（弧度）
export function matRotate(rad) {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

// 应用矩阵到点
export function applyMat(m, p) {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

// 解析图层（处理继承和0图层）
export function resolveLayer(entityLayer, inheritedLayer) {
  const l = (entityLayer ?? "").trim();
  if (!l || l === "0") return (inheritedLayer ?? "").trim();
  return l;
}

// 判断是否为目标图层
export function isTargetLayer(layer) {
  return layer.startsWith("WIRE-") || layer.startsWith("EQUIP-");
}

// 获取块的映射表（兼容数组/对象格式）
export function getBlocksMap(dxf) {
  const blocks = dxf?.blocks;
  if (!blocks) return {};
  if (!Array.isArray(blocks)) return blocks;

  const map = {};
  for (const b of blocks) {
    const name = b?.name;
    if (name) map[name] = b;
  }
  return map;
}

// 生成圆弧的点集
export function arcPoints(center, radius, startRad, endRad, segments = 64) {
  let s = startRad;
  let e = endRad;

  const twoPi = Math.PI * 2;
  while (e - s > twoPi) e -= twoPi;
  while (e - s < -twoPi) e += twoPi;

  const total = e - s;
  const n = Math.max(8, Math.ceil(Math.abs(total) / (twoPi / segments)));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = s + (total * i) / n;
    pts.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) });
  }
  return pts;
}

// 生成圆的点集
export function circlePoints(center, radius, segments = 96) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = (Math.PI * 2 * i) / segments;
    pts.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) });
  }
  return pts;
}

// 将实体转换为绘制路径
export function entityToPaths(e, m, layer) {
  const t = (e.type || "").toUpperCase();

  if (t === "LINE") {
    const a = e.vertices?.[0] ?? e.start;
    const b = e.vertices?.[1] ?? e.end;
    if (!a || !b) return [];
    return [
      {
        layer,
        points: [applyMat(m, { x: a.x, y: a.y }), applyMat(m, { x: b.x, y: b.y })]
      }
    ];
  }

  if (t === "LWPOLYLINE" || t === "POLYLINE") {
    const vs = e.vertices || [];
    if (vs.length < 2) return [];
    const pts = vs.map((v) => applyMat(m, { x: v.x, y: v.y }));
    return [{ layer, points: pts, closed: e.shape === true || e.closed === true }];
  }

  if (t === "CIRCLE") {
    const c = e.center;
    const r = e.radius ?? 0;
    if (!c || r <= 0) return [];
    const pts = circlePoints({ x: c.x, y: c.y }, r).map((p) => applyMat(m, p));
    return [{ layer, points: pts, closed: true }];
  }

  if (t === "ARC") {
    const c = e.center;
    const r = e.radius ?? 0;
    if (!c || r <= 0) return [];
    const s = deg2rad(e.startAngle ?? 0);
    const en = deg2rad(e.endAngle ?? 0);
    const pts = arcPoints({ x: c.x, y: c.y }, r, s, en).map((p) => applyMat(m, p));
    return [{ layer, points: pts, closed: false }];
  }

  return [];
}

// 递归展开实体和块，转换为扁平路径
// export function flattenToPaths(dxf, entities, blocksMap, inheritedLayer, parentMat, depth = 0) {
//   if (!entities?.length) return [];
//   if (depth > 20) return []; // 防止循环引用

//   const out = [];

//   for (const e of entities) {
//     const type = (e.type || "").toUpperCase();

//     if (type === "INSERT") {
//       const blockName = e.name || e.block || e.blockName;
//       const block = blocksMap?.[blockName];
//       if (!block) continue;

//       // 处理INSERT的图层
//       const insertLayer = resolveLayer(e.layer, inheritedLayer);

//       // 计算INSERT的变换矩阵
//       const pos = e.position || e.insertPoint || e.location || { x: 0, y: 0, z: 0 };
//       const sx = e.xScale ?? e.scaleX ?? e.scale?.x ?? 1;
//       const sy = e.yScale ?? e.scaleY ?? e.scale?.y ?? 1;
//       const rotDeg = e.rotation ?? 0;

//       const M = matMul(
//         parentMat,
//         matMul(matTranslate(pos.x ?? 0, pos.y ?? 0), matMul(matRotate(deg2rad(rotDeg)), matScale(sx, sy)))
//       );

//       // 递归处理块内的实体
//       const blockEntities = block.entities ?? [];
//       out.push(...flattenToPaths(dxf, blockEntities, blocksMap, insertLayer, M, depth + 1));
//       continue;
//     }

//     // 过滤目标图层
//     const layer = resolveLayer(e.layer, inheritedLayer);
//     if (!isTargetLayer(layer)) continue;

//     // 转换实体为路径
//     out.push(...entityToPaths(e, parentMat, layer));
//   }

//   return out;
// }

// 计算包围盒：{ minX, minY, maxX, maxY }
function pathsToBBox(paths) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let hasPoint = false;

  for (const p of paths || []) {
    const pts = pathToPoints(p);
    for (const pt of pts) {
      if (!pt) continue;
      const x = pt.x ?? pt[0];
      const y = pt.y ?? pt[1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      hasPoint = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (!hasPoint) return null;
  return { minX, minY, maxX, maxY };
}

// 尽量兼容各种 path 结构：points/vertices/数组/带bbox
function pathToPoints(path) {
  if (!path) return [];
  // 如果你已有 bbox，直接用 bbox 也行（这里优先点集）
  if (Array.isArray(path)) return path; // 直接就是点数组
  if (Array.isArray(path.points)) return path.points;
  if (Array.isArray(path.vertices)) return path.vertices;
  if (Array.isArray(path.pts)) return path.pts;

  // 有些实现会给 { bbox: {minX,...} }，那就退化成四角点
  const b = path.bbox;
  if (b && [b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)) {
    return [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY }
    ];
  }
  return [];
}

// 生成矩形路径（按你原本 paths 的结构可自行调整字段名）
function bboxToRectPath(bbox, layer, meta = {}) {
  const { minX, minY, maxX, maxY } = bbox;
  return {
    type: "RECT",
    layer,
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
      { x: minX, y: minY } // 显式闭合（如果你下游用 closed=true 可去掉这一点）
    ],
    ...meta
  };
}

function isWireLayer(layer) {
  const s = (layer ?? "").toString().toUpperCase();
  return s.startsWith("WIRE-照明");
}

/**
 * asRect=true：输出“紧包矩形”
 * asRect=false：输出“真实路径”（用于内部计算 bbox）
 */
export function flattenToPaths(
  dxf,
  entities,
  blocksMap,
  inheritedLayer,
  parentMat,
  depth = 0,
  options = { asRect: true }
) {
  if (!entities?.length) return [];
  if (depth > 20) return []; // 防止循环引用

  const { asRect } = options;
  const out = [];

  for (const e of entities) {
    const type = (e.type || "").toUpperCase();

    if (type === "INSERT") {
      const blockName = e.name || e.block || e.blockName;
      const block = blocksMap?.[blockName];
      if (!block) continue;

      const insertLayer = resolveLayer(e.layer, inheritedLayer);

      const pos = e.position || e.insertPoint || e.location || { x: 0, y: 0, z: 0 };
      const sx = e.xScale ?? e.scaleX ?? e.scale?.x ?? 1;
      const sy = e.yScale ?? e.scaleY ?? e.scale?.y ?? 1;
      const rotDeg = e.rotation ?? 0;

      const M = matMul(
        parentMat,
        matMul(matTranslate(pos.x ?? 0, pos.y ?? 0), matMul(matRotate(deg2rad(rotDeg)), matScale(sx, sy)))
      );

      const blockEntities = block.entities ?? [];

      // 先拿“真实路径”用于算 bbox
      const childPaths = flattenToPaths(dxf, blockEntities, blocksMap, insertLayer, M, depth + 1, { asRect: false });

      if (!asRect) {
        out.push(...childPaths);
      } else {
        const bbox = pathsToBBox(childPaths);
        if (bbox) {
          out.push(
            bboxToRectPath(bbox, insertLayer, {
              sourceType: "INSERT",
              blockName
            })
          );
        }
      }
      continue;
    }

    // 过滤目标图层
    const layer = resolveLayer(e.layer, inheritedLayer);
    if (!isTargetLayer(layer)) continue;

    // 真实路径
    const paths = entityToPaths(e, parentMat, layer);

    // 规则：WIRE- 开头的不变，其它变 AABB 矩形
    if (isWireLayer(layer)) {
      out.push(...paths);
    } else {
      const bbox = pathsToBBox(paths);
      if (bbox) out.push(bboxToRectPath(bbox, layer, { sourceType: type }));
    }

    // if (!asRect) {
    //   out.push(...paths);
    // } else {
    //   const bbox = pathsToBBox(paths);
    //   if (bbox) {
    //     out.push(
    //       bboxToRectPath(bbox, layer, {
    //         sourceType: type
    //       })
    //     );
    //   }
    // }
  }

  return out;
}

// =======================
// 0) 小工具：ID/容差
// =======================
const EPS = 1500e-1;

// ---------- 几何工具 ----------
function dist2(a, b) {
  const dx = a.x - b.x,
    dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function bboxFromRectObj(rectObj) {
  return bboxOfRectObj(rectObj); // 你已有的
}

function rectEdges(b) {
  const p1 = { x: b.minX, y: b.minY };
  const p2 = { x: b.maxX, y: b.minY };
  const p3 = { x: b.maxX, y: b.maxY };
  const p4 = { x: b.minX, y: b.maxY };
  return [
    [p1, p2],
    [p2, p3],
    [p3, p4],
    [p4, p1]
  ];
}

function pointInRectBBox(pt, b) {
  return pt.x >= b.minX - EPS && pt.x <= b.maxX + EPS && pt.y >= b.minY - EPS && pt.y <= b.maxY + EPS;
}

// 线段相交点（包含端点接触）；平行/共线时返回 null（够用：接入点一般是端点或非共线交点）
function segmentIntersectionPoint(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };

  const rxs = r.x * s.y - r.y * s.x;
  const q_p = { x: c.x - a.x, y: c.y - a.y };
  const qpxr = q_p.x * r.y - q_p.y * r.x;

  if (Math.abs(rxs) < EPS) {
    // 平行或共线，接入点多数情况下由端点判断即可
    return null;
  }

  const t = (q_p.x * s.y - q_p.y * s.x) / rxs;
  const u = qpxr / rxs;

  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;

  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

// 求 wire 与 rect 的“接入点”（返回 0~多个点），通常每条 wire 对一个 part 给 1 个代表点
function pickWireAttachPointToRect(wireObj, rectObj) {
  const rb = bboxFromRectObj(rectObj);
  if (!rb) return null;

  // 优先用 wire 两端点（更符合“接线”语义）
  const pts = wireObj.points || [];
  if (pts.length < 2) return null;
  const head = pts[0];
  const tail = pts[pts.length - 1];

  if (pointInRectBBox(head, rb)) return { x: head.x, y: head.y };
  if (pointInRectBBox(tail, rb)) return { x: tail.x, y: tail.y };

  // 不在内部，就找线段与矩形边的交点，取离 wire 端点最近的那个交点
  const edges = rectEdges(rb);
  const segs = polylineSegments(pts); // 你已有的

  let best = null;
  let bestD = Infinity;

  for (const [a, b] of segs) {
    for (const [c, d] of edges) {
      const ip = segmentIntersectionPoint(a, b, c, d);
      if (!ip) continue;

      const dmin = Math.min(dist2(ip, head), dist2(ip, tail));
      if (dmin < bestD) {
        bestD = dmin;
        best = ip;
      }
    }
  }

  return best; // 可能为 null
}

// 从多个接入点里取“最远的一对”，作为 part 两端
function pickFarthestPair(points) {
  if (!points || points.length < 2) return null;
  let best = null;
  let bestD = -1;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = dist2(points[i], points[j]);
      if (d > bestD) {
        bestD = d;
        best = [points[i], points[j]];
      }
    }
  }
  return best;
}

function polylineLength(points) {
  let len = 0;
  for (let i = 1; i < (points?.length || 0); i++) {
    const a = points[i - 1],
      b = points[i];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    len += Math.hypot(dx, dy);
  }
  return len;
}

// 给 comp 里的每个 part 生成 link 段，写入 part.link
function buildPartLinks(comp) {
  const wires = comp.wires || [];
  const parts = comp.parts || [];

  for (const p of parts) {
    const attaches = [];

    for (const w of wires) {
      // 先用你已有的精确相交判断做过滤（避免无关 wire）
      if (!polylineIntersectsRect(w, p)) continue;

      const ap = pickWireAttachPointToRect(w, p);
      if (!ap) continue;

      attaches.push({
        wireId: w.__id,
        x: ap.x,
        y: ap.y
      });
    }

    // 去重（多个 wire 可能得到同一个接入点）
    const uniq = [];
    const seen = new Set();
    for (const a of attaches) {
      const k = `${Math.round(a.x / EPS)}:${Math.round(a.y / EPS)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push({ x: a.x, y: a.y, wireId: a.wireId });
    }

    const pair = pickFarthestPair(uniq);
    if (!pair) continue;

    const [p1, p2] = pair;

    // 写入 part.link
    p.link = p.link || [];
    const linkObj = {
      __id: `link:${p.__id}:${p.link.length}`,
      type: "LINK",
      layer: "LINK",
      closed: false,
      points: [
        { x: p1.x, y: p1.y },
        { x: p2.x, y: p2.y }
      ],
      from: [p1.wireId, p2.wireId],
      partId: p.__id
    };
    linkObj.len = polylineLength(linkObj.points);
    p.link.push(linkObj);
  }
}

function makeIds(arr, prefix) {
  return arr.map((o, i) => ({ ...o, __id: `${prefix}${i}` }));
}

function keyOf(node) {
  return `${node.kind}:${node.id}`;
}

// =======================
// 1) 几何：矩形/线段/折线相交
// =======================
function rectFromPoints(points) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points || []) {
    const x = p.x,
      y = p.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export function bboxOfRectObj(rectObj) {
  // rectObj.points 是闭合矩形点（最后一点可能重复）
  return rectFromPoints(rectObj.points);
}

export function bboxOfWireObj(wireObj) {
  return rectFromPoints(wireObj.points);
}

function pointInRect(pt, r) {
  return pt.x >= r.minX - EPS && pt.x <= r.maxX + EPS && pt.y >= r.minY - EPS && pt.y <= r.maxY + EPS;
}

function bboxIntersects(a, b) {
  return !(a.maxX < b.minX - EPS || a.minX > b.maxX + EPS || a.maxY < b.minY - EPS || a.minY > b.maxY + EPS);
}

function orient(a, b, c) {
  // 叉积符号
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(v) < EPS) return 0;
  return v > 0 ? 1 : -1;
}

function onSegment(a, b, p) {
  return (
    Math.min(a.x, b.x) - EPS <= p.x &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    Math.min(a.y, b.y) - EPS <= p.y &&
    p.y <= Math.max(a.y, b.y) + EPS &&
    orient(a, b, p) === 0
  );
}

function segmentsIntersect(a, b, c, d) {
  // 线段 ab 与 cd 是否相交/接触/重叠
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;

  // 共线/端点落在对方线段上
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;

  return false;
}

function polylineSegments(points) {
  const segs = [];
  for (let i = 0; i < (points?.length || 0) - 1; i++) {
    const p1 = points[i],
      p2 = points[i + 1];
    if (!p1 || !p2) continue;
    segs.push([p1, p2]);
  }
  return segs;
}

function segmentIntersectsRect(a, b, r) {
  // 1) 任一端点在矩形内
  if (pointInRect(a, r) || pointInRect(b, r)) return true;

  // 2) 与矩形四条边相交
  const p1 = { x: r.minX, y: r.minY };
  const p2 = { x: r.maxX, y: r.minY };
  const p3 = { x: r.maxX, y: r.maxY };
  const p4 = { x: r.minX, y: r.maxY };

  if (segmentsIntersect(a, b, p1, p2)) return true;
  if (segmentsIntersect(a, b, p2, p3)) return true;
  if (segmentsIntersect(a, b, p3, p4)) return true;
  if (segmentsIntersect(a, b, p4, p1)) return true;

  return false;
}

export function polylineIntersectsRect(wire, rectObj) {
  const r = bboxOfRectObj(rectObj);
  if (!r) return false;

  const wb = bboxOfWireObj(wire);
  if (!wb || !bboxIntersects(wb, r)) return false;

  const segs = polylineSegments(wire.points);
  for (const [a, b] of segs) {
    if (segmentIntersectsRect(a, b, r)) return true;
  }
  return false;
}

export function polylineIntersectsPolyline(w1, w2) {
  const b1 = bboxOfWireObj(w1);
  const b2 = bboxOfWireObj(w2);
  if (!b1 || !b2 || !bboxIntersects(b1, b2)) return false;

  const s1 = polylineSegments(w1.points);
  const s2 = polylineSegments(w2.points);
  for (const [a, b] of s1) {
    for (const [c, d] of s2) {
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

// =======================
// 2) 简单空间索引（网格哈希）
//    用 bbox 预筛候选，避免 O(n^2)
// =======================
export function makeGridIndex(items, getBBox, cellSize = 2000) {
  const grid = new Map();

  function cellKey(ix, iy) {
    return `${ix},${iy}`;
  }

  function addToCell(ix, iy, id) {
    const k = cellKey(ix, iy);
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(id);
  }

  function bboxToCells(b) {
    const x0 = Math.floor(b.minX / cellSize);
    const x1 = Math.floor(b.maxX / cellSize);
    const y0 = Math.floor(b.minY / cellSize);
    const y1 = Math.floor(b.maxY / cellSize);
    const cells = [];
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) cells.push([ix, iy]);
    }
    return cells;
  }

  // build
  const bboxes = new Map(); // id -> bbox
  for (const it of items) {
    const b = getBBox(it);
    if (!b) continue;
    bboxes.set(it.__id, b);
    for (const [ix, iy] of bboxToCells(b)) addToCell(ix, iy, it.__id);
  }

  function query(bbox) {
    const out = new Set();
    for (const [ix, iy] of bboxToCells(bbox)) {
      const k = cellKey(ix, iy);
      const arr = grid.get(k);
      if (!arr) continue;
      for (const id of arr) out.add(id);
    }
    return out;
  }

  return { bboxes, query };
}

// =======================
// 3) 构建链路集合（从每个 box 开始 BFS）
// =======================
export function buildLinkSets({ box, eql, eqe, eqp, wire }) {
  // 给对象加 __id，方便去重/索引
  const boxes = makeIds(box || [], "box:");
  const wires = makeIds(wire || [], "wire:");
  const parts = [
    ...makeIds(eql || [], "part:eql:"),
    ...makeIds(eqe || [], "part:eqe:"),
    ...makeIds(eqp || [], "part:eqp:")
  ];

  const wireById = new Map(wires.map((w) => [w.__id, w]));
  const partById = new Map(parts.map((p) => [p.__id, p]));
  const boxById = new Map(boxes.map((b) => [b.__id, b]));

  // 空间索引
  const wireIndex = makeGridIndex(wires, bboxOfWireObj);
  const partIndex = makeGridIndex(parts, bboxOfRectObj);
  const boxIndex = makeGridIndex(boxes, bboxOfRectObj);

  // 为了避免“同一连通网络被多个 box 重复产出”，做一次全局去重
  const seenComponentKey = new Set();

  const results = [];

  for (const b of boxes) {
    const bBbox = bboxOfRectObj(b);
    if (!bBbox) continue;

    // BFS：节点只分三种：box / wire / part
    const q = [{ kind: "box", id: b.__id }];
    const visited = new Set([keyOf(q[0])]);

    const comp = {
      boxId: b.__id,
      boxes: [b],
      wires: [],
      parts: []
    };

    const wireSet = new Set();
    const partSet = new Set();

    while (q.length) {
      const cur = q.shift();

      if (cur.kind === "box") {
        const rectObj = boxById.get(cur.id);
        const rbox = bboxOfRectObj(rectObj);
        const candWireIds = wireIndex.query(rbox);

        for (const wid of candWireIds) {
          const w = wireById.get(wid);
          if (!w) continue;
          // 精确相交判断
          if (!polylineIntersectsRect(w, rectObj)) continue;

          const nk = keyOf({ kind: "wire", id: wid });
          if (visited.has(nk)) continue;
          visited.add(nk);

          wireSet.add(wid);
          comp.wires.push(w);
          q.push({ kind: "wire", id: wid });
        }
      }

      if (cur.kind === "part") {
        const partObj = partById.get(cur.id);
        const pb = bboxOfRectObj(partObj);
        const candWireIds = wireIndex.query(pb);

        for (const wid of candWireIds) {
          const w = wireById.get(wid);
          if (!w) continue;
          if (!polylineIntersectsRect(w, partObj)) continue;

          const nk = keyOf({ kind: "wire", id: wid });
          if (visited.has(nk)) continue;
          visited.add(nk);

          wireSet.add(wid);
          comp.wires.push(w);
          q.push({ kind: "wire", id: wid });
        }
      }

      if (cur.kind === "wire") {
        const w = wireById.get(cur.id);
        if (!w) continue;

        const wb = bboxOfWireObj(w);
        if (!wb) continue;

        // wire -> part
        const candPartIds = partIndex.query(wb);
        for (const pid of candPartIds) {
          const p = partById.get(pid);
          if (!p) continue;
          // 精确：wire 与矩形相交
          if (!polylineIntersectsRect(w, p)) continue;

          const nk = keyOf({ kind: "part", id: pid });
          if (visited.has(nk)) continue;
          visited.add(nk);

          partSet.add(pid);
          comp.parts.push(p);
          q.push({ kind: "part", id: pid });
        }

        // wire -> wire（含线段交叉、端点接触、共线重叠）
        const candWireIds2 = wireIndex.query(wb);
        for (const wid2 of candWireIds2) {
          if (wid2 === cur.id) continue;
          const w2 = wireById.get(wid2);
          if (!w2) continue;
          if (!polylineIntersectsPolyline(w, w2)) continue;

          const nk = keyOf({ kind: "wire", id: wid2 });
          if (visited.has(nk)) continue;
          visited.add(nk);

          wireSet.add(wid2);
          comp.wires.push(w2);
          q.push({ kind: "wire", id: wid2 });
        }

        // （可选）wire -> box：如果你希望链路里也把“另一个箱柜”算进来
        // 如果不需要，把这一段删掉
        // const candBoxIds = boxIndex.query(wb);
        // for (const bid of candBoxIds) {
        //   const bx = boxById.get(bid);
        //   if (!bx) continue;
        //   if (!polylineIntersectsRect(w, bx)) continue;

        //   const nk = keyOf({ kind: "box", id: bid });
        //   if (visited.has(nk)) continue;
        //   visited.add(nk);

        //   comp.boxes.push(bx);
        //   q.push({ kind: "box", id: bid });
        // }
      }
    }

    // 去重：按（boxes/wires/parts）组成一个稳定 key
    const compKey =
      [...new Set(comp.boxes.map((x) => x.__id))].sort().join("|") +
      "##" +
      [...wireSet].sort().join("|") +
      "##" +
      [...partSet].sort().join("|");

    if (seenComponentKey.has(compKey)) continue;
    seenComponentKey.add(compKey);

    // 如果你只想要“确实连到了 part 的链路”，可加过滤：
    // if (comp.parts.length === 0) continue;

    // 生成每个 part 的“跨接线段”，存入 part.link
    buildPartLinks(comp);

    results.push(comp);
  }

  return results;
}

function shortId(id) {
  // "wire:12" -> "wire12", "part:eqe:5" -> "part5"
  const s = String(id || "");
  if (s.startsWith("wire:")) return "wire" + s.split(":")[1];
  if (s.startsWith("box:")) return "box" + s.split(":")[1];
  if (s.startsWith("part:")) return "part" + s.split(":").pop();
  if (s.startsWith("link:")) return "link" + s.split(":").pop();
  return s;
}

function buildAdjacencyForComp(comp) {
  const wires = comp.wires || [];
  const parts = comp.parts || [];
  const boxes = comp.boxes || [];

  const wireIndex = makeGridIndex(wires, bboxOfWireObj);
  const partIndex = makeGridIndex(parts, bboxOfRectObj);
  const boxIndex = makeGridIndex(boxes, bboxOfRectObj);

  const boxToWires = new Map(); // boxId -> [wireId]
  const wireToParts = new Map(); // wireId -> [partId]
  const partToWires = new Map(); // partId -> [wireId]
  const wireToWires = new Map(); // wireId -> [wireId]

  const wireById = new Map(wires.map((w) => [w.__id, w]));
  const partById = new Map(parts.map((p) => [p.__id, p]));
  const boxById = new Map(boxes.map((b) => [b.__id, b]));

  // box -> wires
  for (const b of boxes) {
    const bb = bboxOfRectObj(b);
    const cands = wireIndex.query(bb);
    const arr = [];
    for (const wid of cands) {
      const w = wireById.get(wid);
      if (w && polylineIntersectsRect(w, b)) arr.push(wid);
    }
    boxToWires.set(b.__id, arr);
  }

  // part <-> wires
  for (const p of parts) {
    const pb = bboxOfRectObj(p);
    const cands = wireIndex.query(pb);
    const arr = [];
    for (const wid of cands) {
      const w = wireById.get(wid);
      if (w && polylineIntersectsRect(w, p)) arr.push(wid);
    }
    partToWires.set(p.__id, arr);
  }

  // wire -> parts
  for (const w of wires) {
    const wb = bboxOfWireObj(w);
    const cands = partIndex.query(wb);
    const arr = [];
    for (const pid of cands) {
      const p = partById.get(pid);
      if (p && polylineIntersectsRect(w, p)) arr.push(pid);
    }
    wireToParts.set(w.__id, arr);
  }

  // wire -> wire（可选；你需要 wire-wire 继续递归就用它）
  for (const w of wires) {
    const wb = bboxOfWireObj(w);
    const cands = wireIndex.query(wb);
    const arr = [];
    for (const wid2 of cands) {
      if (wid2 === w.__id) continue;
      const w2 = wireById.get(wid2);
      if (w2 && polylineIntersectsPolyline(w, w2)) arr.push(wid2);
    }
    wireToWires.set(w.__id, arr);
  }

  return { wireById, partById, boxById, boxToWires, wireToParts, partToWires, wireToWires };
}

function printRoutesFromBox(comp, opts = {}) {
  const {
    scale = 1, // 如果你要把坐标单位换算成米之类，可用这个比例
    decimals = 1, // 打印小数位
    includeWireWire = false, // 是否允许 wire->wire 跳转
    maxDepth = 80 // 防止异常数据爆栈
  } = opts;

  const { wireById, partById, boxById, boxToWires, wireToParts, partToWires, wireToWires } =
    buildAdjacencyForComp(comp);

  // 预计算 wire 长度
  const wireLen = new Map();
  for (const [id, w] of wireById) wireLen.set(id, polylineLength(w.points) * scale);

  // 取 part 的 link（两端件：只用第 0 条）
  function getLink(part, wireIn, wireOut) {
    const lk = part?.link?.[0];
    if (!lk) return null;
    const from = lk.from || [];
    // 只在两端匹配时认为可走
    if (from.includes(wireIn) && from.includes(wireOut)) return lk;
    return null;
  }

  function fmt(n) {
    return (n || 0).toFixed(decimals);
  }

  // 输出：box 可能不止一个，这里对 comp.boxes 都跑一遍
  for (const b of comp.boxes || []) {
    const startWires = boxToWires.get(b.__id) || [];

    for (const w0 of startWires) {
      // 路径 token：box -> wire -> ...
      const tokens = [`${shortId(b.__id)}`, `${shortId(w0)}`];
      const lens = [wireLen.get(w0) || 0];

      const visited = new Set([`box:${b.__id}`, `wire:${w0}`]);

      dfsWire(w0, null, 1);

      function dfsWire(wid, cameFromPartId, depth) {
        if (depth > maxDepth) return;

        // wire -> part
        for (const pid of wireToParts.get(wid) || []) {
          if (pid === cameFromPartId) continue; // 避免立刻回头
          const k = `part:${pid}`;
          if (visited.has(k)) continue;

          visited.add(k);
          const part = partById.get(pid);

          // 到达一个 part（先把 part 写进 tokens；是否带 link 取决于是否能继续）
          tokens.push(shortId(pid));

          dfsPart(pid, wid, depth + 1);

          tokens.pop();
          visited.delete(k);
        }

        // wire -> wire（可选）
        if (includeWireWire) {
          for (const wid2 of wireToWires.get(wid) || []) {
            const k2 = `wire:${wid2}`;
            if (visited.has(k2)) continue;

            visited.add(k2);
            tokens.push(shortId(wid2));
            lens.push(wireLen.get(wid2) || 0);

            dfsWire(wid2, cameFromPartId, depth + 1);

            lens.pop();
            tokens.pop();
            visited.delete(k2);
          }
        }
      }

      function dfsPart(pid, wireIn, depth) {
        if (depth > maxDepth) return;

        const part = partById.get(pid);
        const wiresOnPart = partToWires.get(pid) || [];
        const outs = wiresOnPart.filter((x) => x !== wireIn);

        // 终点 part：没有后续 wire
        if (!outs.length) {
          const total = lens.reduce((a, b) => a + b, 0);
          console.log(`${tokens.join(" -> ")} : ${lens.map(fmt).join(" + ")} = ${fmt(total)}`);
          return;
        }

        // 继续：对每个 wireOut，加入 link + wireOut
        for (const wireOut of outs) {
          const lk = getLink(part, wireIn, wireOut);
          const lkLen = lk ? (lk.len ?? polylineLength(lk.points)) * scale : 0;

          // 把 part token改成带 link：partX(linkY)
          const last = tokens[tokens.length - 1];
          const partToken = lk ? `${last}(${shortId(lk.__id)})` : last;
          tokens[tokens.length - 1] = partToken;

          // push wireOut
          const wKey = `wire:${wireOut}`;
          if (visited.has(wKey)) {
            // 走出去会成环：把当前当终点 part 处理（不再延伸）
            tokens[tokens.length - 1] = last; // 复原
            const total = lens.reduce((a, b) => a + b, 0);
            console.log(`${tokens.join(" -> ")} : ${lens.map(fmt).join(" + ")} = ${fmt(total)}`);
            continue;
          }

          visited.add(wKey);
          tokens.push(shortId(wireOut));
          lens.push(lkLen);
          lens.push(wireLen.get(wireOut) || 0);

          // 从 wireOut 继续，cameFromPart = pid
          dfsWire(wireOut, pid, depth + 1);

          // pop
          lens.pop(); // wireOut
          lens.pop(); // link
          tokens.pop();
          visited.delete(wKey);

          // 复原 part token
          tokens[tokens.length - 1] = last;
        }
      }
    }
  }
}

// 用法：buildLinkSets 后打印每个 linkSet 的所有线路
export function printAllLinkSetRoutes(linkSets, opts) {
  for (const comp of linkSets || []) {
    printRoutesFromBox(comp, opts);
  }
}

export function polylineMidPoint(pts) {
  if (!pts?.length) return null;
  // 用“总长度一半”的位置作为标注点（比取第1个点更稳）
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const half = total / 2;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + seg >= half) {
      const t = seg === 0 ? 0 : (half - acc) / seg;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t
      };
    }
    acc += seg;
  }
  return { x: pts[0].x, y: pts[0].y };
}

export function rectCenter(pts) {
  if (!pts?.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

// export function drawId(ctx, id, x, y, opts = {}) {
//   if (!id || x == null || y == null) return;

//   const { font = "10px Arial", fill = "#111", bg = "rgba(255,255,255,0.0)", pad = 3, offsetX = 6, offsetY = -6 } = opts;

//   // 把“世界坐标”转换为“屏幕坐标”
//   const m = ctx.getTransform();
//   const sx = m.a * x + m.c * y + m.e;
//   const sy = m.b * x + m.d * y + m.f;

//   ctx.save();

//   // 用屏幕坐标绘制，避免被 scale 缩小
//   ctx.setTransform(1, 0, 0, 1, 0, 0);

//   ctx.font = font;
//   ctx.textBaseline = "middle";
//   ctx.textAlign = "left";

//   const text = String(id);
//   const metrics = ctx.measureText(text);
//   const textW = metrics.width;
//   const textH = (metrics.actualBoundingBoxAscent ?? 8) + (metrics.actualBoundingBoxDescent ?? 4);

//   const bx = sx + offsetX;
//   const by = sy + offsetY;

//   // 背景
//   ctx.imageSmoothingEnabled = true;
//   ctx.imageSmoothingQuality = "high";
//   ctx.textRendering = "geometricPrecision";
//   ctx.fillStyle = bg;
//   ctx.fillRect(bx - pad, by - textH / 2 - pad, textW + pad * 2, textH + pad * 2);

//   // 字
//   ctx.fillStyle = fill;
//   ctx.fillText(text, bx, by);

//   ctx.restore();
// }

export function drawId(ctx, id, x, y, opts = {}) {
  if (!id || x == null || y == null) return;

  // 扩展配置项：增加文字对齐方式（left/center/right），默认left
  const {
    font = "10px Arial",
    fill = "#111",
    bg = "rgba(255,255,255,0.0)",
    pad = 3,
    offsetX = 6,
    offsetY = -6,
    align = "left" // 新增：文字对齐方式（left/center/right）
  } = opts;

  // 把“世界坐标”转换为“屏幕坐标”
  const m = ctx.getTransform();
  const sx = m.a * x + m.c * y + m.e;
  const sy = m.b * x + m.d * y + m.f;

  ctx.save();

  // 用屏幕坐标绘制，避免被 scale 缩小
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  ctx.font = font;
  ctx.textBaseline = "middle"; // 垂直居中
  ctx.textAlign = "left"; // 这里固定为left，因为我们手动计算x偏移更可控

  const text = String(id);
  const metrics = ctx.measureText(text);
  const textW = metrics.width; // 文字宽度
  const textH = (metrics.actualBoundingBoxAscent ?? 8) + (metrics.actualBoundingBoxDescent ?? 4); // 文字高度

  // 核心：根据对齐方式和文字宽度调整x坐标
  const bx = sx + offsetX - textW;
  const by = sy + offsetY + textH;

  // 绘制背景（背景位置随文字x坐标同步调整）
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = bg;
  // 背景的x坐标 = 文字x坐标 - 内边距
  // 背景的宽度 = 文字宽度 + 2倍内边距
  ctx.fillRect(bx - pad, by - textH / 2 - pad, textW + pad * 2, textH + pad * 2);

  // 绘制文字
  ctx.fillStyle = fill;
  ctx.fillText(text, bx, by);

  ctx.restore();
}

export const filterName = (str) => {
  return str
    .replaceAll("(link0)", "")
    .replaceAll("link", "L")
    .replaceAll("box", "B")
    .replaceAll("part", "P")
    .replaceAll("wire", "W")
    .replaceAll("eql", "")
    .replaceAll("eqe", "")
    .replaceAll("eqp", "")
    .replaceAll(":", "")
    .replaceAll("LP", "L");
};
