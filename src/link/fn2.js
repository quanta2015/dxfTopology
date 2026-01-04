import { bboxOfWireObj, bboxOfRectObj, polylineIntersectsRect, makeGridIndex, polylineIntersectsPolyline } from "./fn";
function rectBoundsFromPoints(points) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points || []) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
function pointInRectInclusive(pt, rect) {
  const b = rectBoundsFromPoints(rect.points);
  return pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY;
}
function wireTouchesRectInclusive(wire, rect) {
  return (wire.points || []).some((pt) => pointInRectInclusive(pt, rect));
}

export function strokePolyline(ctx, pts) {
  if (!pts || pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

export function printRoute(comp) {
  const box = comp.boxes?.[0];
  if (!box) return;

  const parts = comp.parts || [];
  const wires = comp.wires || [];
  if (!wires.length || !parts.length) return;

  const wireById = new Map(wires.map((w) => [w.__id, w]));
  const wireLenMap = new Map(wires.map((w) => [w.__id, polylineLen(w.points)]));

  // wire 邻接
  const wIndex = makeGridIndex(wires, bboxOfWireObj);
  const adj = new Map(wires.map((w) => [w.__id, new Set()]));

  for (const w of wires) {
    const wb = bboxOfWireObj(w);
    if (!wb) continue;
    for (const wid2 of wIndex.query(wb)) {
      if (wid2 === w.__id) continue;
      if (widNum(wid2) <= widNum(w.__id)) continue;
      const w2 = wireById.get(wid2);
      if (!w2) continue;
      if (!polylineIntersectsPolyline(w, w2)) continue;
      adj.get(w.__id).add(wid2);
      adj.get(wid2).add(w.__id);
    }
  }

  // box 起点 wires（相交 或 端点贴边）
  const startWires = [];
  const rbox = bboxOfRectObj(box);
  for (const wid of wIndex.query(rbox)) {
    const w = wireById.get(wid);
    if (!w) continue;
    if (polylineIntersectsRect(w, box) || wireTouchesRectInclusive(w, box)) startWires.push(wid);
  }

  // Dijkstra：box 到各 wire 的最短路（按 wire 全长计）
  const dist = new Map(wires.map((w) => [w.__id, Infinity]));
  const prev = new Map();

  const heap = [];
  function push(node, d) {
    heap.push({ node, d });
    heap.sort((a, b) => a.d - b.d);
  }

  for (const wid of startWires) {
    const d0 = wireLenMap.get(wid) ?? 0;
    if (d0 < dist.get(wid)) {
      dist.set(wid, d0);
      prev.set(wid, null);
      push(wid, d0);
    }
  }

  while (heap.length) {
    const { node: u, d } = heap.shift();
    if (d !== dist.get(u)) continue;
    for (const v of adj.get(u) || []) {
      const nd = d + (wireLenMap.get(v) ?? 0);
      if (nd < dist.get(v)) {
        dist.set(v, nd);
        prev.set(v, u);
        push(v, nd);
      }
    }
  }

  function pathTo(targetWireId) {
    const res = [];
    let cur = targetWireId;
    while (cur) {
      res.push(cur);
      cur = prev.get(cur);
    }
    return res.reverse();
  }

  const ret = [];

  // 1) 先输出“有 link 的回路线路”（你的原逻辑）
  const linkParts = parts.filter((p) => Array.isArray(p.link) && p.link.length);
  for (const p of linkParts) {
    p.link.forEach((lk, i) => {
      const [wA, wB] = lk.from || [];
      if (!wA || !wB) return;
      const dA = dist.get(wA),
        dB = dist.get(wB);
      const entry = dA <= dB ? wA : wB;
      const other = entry === wA ? wB : wA;
      if (!Number.isFinite(dist.get(entry))) return;

      const prefixWires = pathTo(entry);
      const lens = [];
      const nodes = [`box${pidNum(comp.boxId)}`];

      for (const wid of prefixWires) {
        nodes.push(`wire${pidNum(wid)}`);
        lens.push(wireLenMap.get(wid) ?? 0);
      }

      const partN = `part${pidNum(p.__id)}`;
      const linkTag = `${partN}(link${i})`;

      nodes.push(linkTag);
      nodes.push(`wire${pidNum(other)}`);
      lens.push(lk.len ?? 0);
      lens.push(wireLenMap.get(other) ?? 0);

      nodes.push(linkTag);
      nodes.push(`wire${pidNum(entry)}`);
      lens.push(lk.len ?? 0);
      lens.push(wireLenMap.get(entry) ?? 0);

      nodes.push(partN);

      const sum = lens.reduce((a, b) => a + b, 0);
      console.log(`${nodes.join(" -> ")} : ${lens.map(fmt1).join(" + ")} = ${fmt1(sum)}`);
      ret.push({
        nodes,
        lens,
        sum
      });
    });
  }

  // 2) 再输出“无 link 的终点线路”（本次你缺的 3 条就在这里）
  const terminalParts = parts.filter((p) => !(Array.isArray(p.link) && p.link.length));

  for (const p of terminalParts) {
    const rp = bboxOfRectObj(p);
    const cands = wIndex.query(rp);

    // 找到真正碰到/贴边该 part 的 wires
    const hitWires = [];
    for (const wid of cands) {
      const w = wireById.get(wid);
      if (!w) continue;
      if (polylineIntersectsRect(w, p) || wireTouchesRectInclusive(w, p)) {
        hitWires.push(wid);
      }
    }
    if (!hitWires.length) continue;

    // 选一个 box->wire 最短的作为“接入 wire”
    let best = null;
    for (const wid of hitWires) {
      const d = dist.get(wid);
      if (!Number.isFinite(d)) continue;
      if (!best || d < best.d) best = { wid, d };
    }
    if (!best) continue;

    const prefixWires = pathTo(best.wid);
    const nodes = [`box${pidNum(comp.boxId)}`];
    const lens = [];

    for (const wid of prefixWires) {
      nodes.push(`wire${pidNum(wid)}`);
      lens.push(wireLenMap.get(wid) ?? 0);
    }

    nodes.push(`part${pidNum(p.__id)}`);
    const sum = lens.reduce((a, b) => a + b, 0);
    console.log(`${nodes.join(" -> ")} : ${lens.map(fmt1).join(" + ")} = ${fmt1(sum)}`);
    ret.push({
      nodes,
      lens,
      sum
    });
  }
  // console.log(ret, "debug");

  return ret;
}

function widNum(id) {
  return Number(String(id).split(":")[1] || 0);
}

function pidNum(id) {
  return String(id).split(":").pop();
}

function polylineLen(points) {
  let s = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    s += Math.hypot(dx, dy);
  }
  return s;
}

export function fmt1(x) {
  return Number(x).toFixed(1);
}

// /**
//  * 对一个 comp（buildLinkSets 的一个结果）打印“7 条线路”：
//  * 每个带 link 的 part 只打印 1 条，前缀取 box->entryWire 的最短 wire 路径（按 wire 全长计）
//  */
// export function printRoute(comp) {
//   const box = comp.boxes?.[0];
//   if (!box) return;

//   // 只认“带 link”的 part（eqp）
//   const linkParts = (comp.parts || []).filter((p) => Array.isArray(p.link) && p.link.length);
//   if (!linkParts.length) return;

//   // wire 映射 & wire 长度
//   const wires = comp.wires || [];
//   const wireById = new Map(wires.map((w) => [w.__id, w]));
//   const wireLenMap = new Map(wires.map((w) => [w.__id, polylineLen(w.points)]));

//   // wire 邻接（相交/接触/重叠就算连通）
//   const wIndex = makeGridIndex(wires, bboxOfWireObj);
//   const adj = new Map(wires.map((w) => [w.__id, new Set()]));

//   for (const w of wires) {
//     const wb = bboxOfWireObj(w);
//     if (!wb) continue;
//     const cands = wIndex.query(wb);
//     for (const wid2 of cands) {
//       if (wid2 === w.__id) continue;
//       // 去重：只做一次检测
//       if (widNum(wid2) <= widNum(w.__id)) continue;
//       const w2 = wireById.get(wid2);
//       if (!w2) continue;
//       if (!polylineIntersectsPolyline(w, w2)) continue;

//       adj.get(w.__id).add(wid2);
//       adj.get(wid2).add(w.__id);
//     }
//   }

//   // box 起点能直连的 wires
//   const rbox = bboxOfRectObj(box);
//   const startWires = [];
//   for (const wid of wIndex.query(rbox)) {
//     const w = wireById.get(wid);
//     if (!w) continue;
//     if (polylineIntersectsRect(w, box)) startWires.push(wid);
//   }

//   // ---------- Dijkstra（一次跑完，拿到 box 到每根 wire 的最短路） ----------
//   const dist = new Map();
//   const prev = new Map();
//   for (const w of wires) dist.set(w.__id, Infinity);

//   // 简单小根堆（数据不大，数组也行）
//   const heap = [];
//   function push(node, d) {
//     heap.push({ node, d });
//     heap.sort((a, b) => a.d - b.d);
//   }

//   for (const wid of startWires) {
//     const d0 = wireLenMap.get(wid) ?? 0;
//     if (d0 < dist.get(wid)) {
//       dist.set(wid, d0);
//       prev.set(wid, null);
//       push(wid, d0);
//     }
//   }

//   while (heap.length) {
//     const { node: u, d } = heap.shift();
//     if (d !== dist.get(u)) continue;

//     for (const v of adj.get(u) || []) {
//       const nd = d + (wireLenMap.get(v) ?? 0);
//       if (nd < dist.get(v)) {
//         dist.set(v, nd);
//         prev.set(v, u);
//         push(v, nd);
//       }
//     }
//   }

//   function pathTo(targetWireId) {
//     const res = [];
//     let cur = targetWireId;
//     while (cur) {
//       res.push(cur);
//       cur = prev.get(cur);
//     }
//     return res.reverse(); // 从 box 侧到 target
//   }

//   // ---------- 每个带 link 的 part 只打印 1 条 ----------
//   for (const p of linkParts) {
//     p.link.forEach((lk, i) => {
//       const [wA, wB] = lk.from || [];
//       if (!wA || !wB) return;

//       // 入口 wire = box->wire 最短的那根
//       const dA = dist.get(wA);
//       const dB = dist.get(wB);
//       const entry = dA <= dB ? wA : wB;
//       const other = entry === wA ? wB : wA;

//       if (!Number.isFinite(dist.get(entry))) return;

//       const prefixWires = pathTo(entry); // 以 entry 结尾
//       const lens = [];

//       // 线路文本节点
//       const nodes = [];
//       nodes.push(`box${pidNum(comp.boxId)}`);

//       // 前缀 wires
//       for (const wid of prefixWires) {
//         nodes.push(`wire${pidNum(wid)}`);
//         lens.push(wireLenMap.get(wid) ?? 0);
//       }

//       const partN = `part${pidNum(p.__id)}`;
//       const linkTag = `${partN}(link${i})`;

//       // 固定回路段：part(link)->otherWire->part(link)->entryWire->part
//       nodes.push(linkTag);
//       nodes.push(`wire${pidNum(other)}`);
//       lens.push(lk.len ?? 0);
//       lens.push(wireLenMap.get(other) ?? 0);

//       nodes.push(linkTag);
//       nodes.push(`wire${pidNum(entry)}`);
//       lens.push(lk.len ?? 0);
//       lens.push(wireLenMap.get(entry) ?? 0);

//       nodes.push(partN);

//       const sum = lens.reduce((a, b) => a + b, 0);

//       console.log(`${nodes.join(" -> ")} : ${lens.map(fmt1).join(" + ")} = ${fmt1(sum)}`);
//     });
//   }
// }
