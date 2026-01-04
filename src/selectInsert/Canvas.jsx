// import React, { useEffect, useRef, useState, useCallback } from "react";
// import DxfParser from "dxf-parser";
// import "./Canvas.css";

// /** ====== 简单的 2D 矩阵工具，用于计算世界坐标 ====== */
// const Mat3 = {
//   identity: () => [1, 0, 0, 1, 0, 0], // [a, b, c, d, tx, ty]
//   multiply: (m1, m2) => {
//     const [a1, b1, c1, d1, tx1, ty1] = m1;
//     const [a2, b2, c2, d2, tx2, ty2] = m2;
//     return [
//       a1 * a2 + c1 * b2,
//       b1 * a2 + d1 * b2,
//       a1 * c2 + c1 * d2,
//       b1 * c2 + d1 * d2,
//       a1 * tx2 + c1 * ty2 + tx1,
//       b1 * tx2 + d1 * ty2 + ty1
//     ];
//   },
//   // 生成 INSERT 的变换矩阵
//   fromInsert: (pos, scale, rotDeg) => {
//     const rad = (rotDeg * Math.PI) / 180;
//     const c = Math.cos(rad);
//     const s = Math.sin(rad);
//     // 顺序：缩放 -> 旋转 -> 平移
//     // mScale = [sx, 0, 0, sy, 0, 0]
//     // mRot = [c, s, -s, c, 0, 0]
//     // mTrans = [1, 0, 0, 1, x, y]
//     // 组合后:
//     return [c * scale.x, s * scale.x, -s * scale.y, c * scale.y, pos.x, pos.y];
//   },
//   apply: (m, p) => ({
//     x: m[0] * p.x + m[2] * p.y + m[4],
//     y: m[1] * p.x + m[3] * p.y + m[5]
//   })
// };

// function getAttdefText(ent) {
//   // ATTDEF 常见字段：tag / prompt / text / defaultValue
//   const s = ent.text ?? ent.string ?? ent.value ?? ent.defaultValue ?? ent.prompt ?? ent.tag ?? "";
//   return s == null ? "" : String(s);
// }

// function getAttdefInsert(ent) {
//   // ATTDEF 常见：startPoint / position / insert
//   return asPoint(ent.startPoint) || asPoint(ent.position) || asPoint(ent.insert) || asPoint(ent.insertionPoint) || null;
// }

// function getSolidPoints(ent) {
//   // SOLID 常见四个点：p1..p4（有些只用3个点）
//   const p1 = asPoint(ent.p1) || asPoint(ent.point1) || asPoint(ent.firstCorner);
//   const p2 = asPoint(ent.p2) || asPoint(ent.point2) || asPoint(ent.secondCorner);
//   const p3 = asPoint(ent.p3) || asPoint(ent.point3) || asPoint(ent.thirdCorner);
//   const p4 = asPoint(ent.p4) || asPoint(ent.point4) || asPoint(ent.fourthCorner);
//   const pts = [p1, p2, p3, p4].filter(Boolean);
//   return pts.length >= 3 ? pts : null;
// }

// /** ===== 2D 仿射矩阵（a,b,c,d,e,f 对应 CanvasTransform）===== */
// function matIdentity() {
//   return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
// }
// function lerp(a, b, t) {
//   return a + (b - a) * t;
// }

// // bulge -> 圆弧采样点（在“未变换的世界坐标”里算，再统一过 worldMat）
// function bulgeToPoints(p1, p2, bulge, segments = 16) {
//   // bulge = tan(theta/4)，theta 为该段圆弧圆心角（有正负方向）
//   const x1 = p1.x,
//     y1 = p1.y;
//   const x2 = p2.x,
//     y2 = p2.y;
//   const dx = x2 - x1,
//     dy = y2 - y1;

//   const chord = Math.hypot(dx, dy);
//   if (!Number.isFinite(chord) || chord === 0) return [p1, p2];

//   const theta = 4 * Math.atan(bulge); // 圆心角
//   // 近似直线
//   if (Math.abs(theta) < 1e-6) return [p1, p2];

//   const r = chord / (2 * Math.sin(Math.abs(theta) / 2)); // 半径（正值）
//   const mx = (x1 + x2) / 2;
//   const my = (y1 + y2) / 2;

//   // 弦的法向（单位）
//   const ux = dx / chord,
//     uy = dy / chord;
//   // 左法向
//   const nx = -uy,
//     ny = ux;

//   // 弦中点到圆心的距离
//   const h = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4));

//   // bulge>0 在左侧，bulge<0 在右侧
//   const sign = bulge >= 0 ? 1 : -1;
//   const cx = mx + sign * nx * h;
//   const cy = my + sign * ny * h;

//   const a1 = Math.atan2(y1 - cy, x1 - cx);
//   const a2 = Math.atan2(y2 - cy, x2 - cx);

//   // 按 bulge 的方向走：bulge>0 逆时针，bulge<0 顺时针
//   let start = a1,
//     end = a2;
//   if (bulge > 0 && end < start) end += Math.PI * 2;
//   if (bulge < 0 && end > start) end -= Math.PI * 2;

//   const pts = [];
//   for (let i = 0; i <= segments; i++) {
//     const t = i / segments;
//     const ang = lerp(start, end, t);
//     pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
//   }
//   return pts;
// }

// function matMul(m1, m2) {
//   // m = m1 * m2
//   return {
//     a: m1.a * m2.a + m1.c * m2.b,
//     b: m1.b * m2.a + m1.d * m2.b,
//     c: m1.a * m2.c + m1.c * m2.d,
//     d: m1.b * m2.c + m1.d * m2.d,
//     e: m1.a * m2.e + m1.c * m2.f + m1.e,
//     f: m1.b * m2.e + m1.d * m2.f + m1.f
//   };
// }
// function matTranslate(tx, ty) {
//   return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
// }
// function matScale(sx, sy) {
//   return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
// }
// function matRotate(rad) {
//   const cos = Math.cos(rad),
//     sin = Math.sin(rad);
//   return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
// }
// function applyMatToPoint(m, p) {
//   const pt = asPoint(p);
//   if (!pt) return null;
//   return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
// }

// /** ===== INSERT 的变换矩阵（2D：平移+旋转+缩放）===== */
// function getInsertMatrix(ent) {
//   const pos = asPoint(ent.position) || asPoint(ent.insert) || asPoint(ent.insertionPoint);
//   if (!pos) return null;

//   const sx = Number.isFinite(ent.xScale) ? ent.xScale : 1;
//   const sy = Number.isFinite(ent.yScale) ? ent.yScale : 1;
//   const rotDeg = Number.isFinite(ent.rotation) ? ent.rotation : 0;

//   // DXF：先缩放/旋转，再平移到 position
//   const mS = matScale(sx, sy);
//   const mR = matRotate((rotDeg * Math.PI) / 180);
//   const mT = matTranslate(pos.x, pos.y);
//   return matMul(mT, matMul(mR, mS));
// }

// /** ===== 建 blocks 索引（dxf-parser 的 blocks 可能是对象或数组）===== */
// function buildBlockIndex(dxf) {
//   const map = new Map();

//   const b = dxf?.blocks;
//   if (!b) return map;

//   if (Array.isArray(b)) {
//     for (const item of b) {
//       if (item?.name) map.set(item.name, item);
//     }
//   } else {
//     // 常见：{ BLOCK_NAME: { name, entities... }, ... }
//     for (const k of Object.keys(b)) {
//       const item = b[k];
//       if (item?.name) map.set(item.name, item);
//       else if (item?.entities) map.set(k, { name: k, ...item });
//     }
//   }

//   return map;
// }

// function getTextRaw(ent) {
//   // TEXT/MTEXT 字段兼容
//   const s = ent.text ?? ent.string ?? ent.value ?? "";
//   return s == null ? "" : String(s);
// }

// function normalizeMText(s) {
//   // 常见 MTEXT：\P 换行；\~ 不间断空格；简单去掉 \H...\; 等格式控制（先做最小可用）
//   return s
//     .replace(/\\P/g, "\n")
//     .replace(/\\~+/g, " ")
//     .replace(/\{\\[^}]*\}/g, "") // 去掉 {...} 内的格式块（粗略）
//     .replace(/\\[A-Za-z][^;]*;/g, "") // \H...\; \f...\; 等（粗略）
//     .trimEnd();
// }

// function getTextInsert2(ent) {
//   // 你已有 getTextInsert，也可以直接用这个替换它（覆盖更多字段）
//   return (
//     asPoint(ent.position) ||
//     asPoint(ent.startPoint) ||
//     asPoint(ent.insert) ||
//     asPoint(ent.insertionPoint) ||
//     asPoint(ent.alignPoint) ||
//     null
//   );
// }

// function getTextHeight(ent) {
//   // TEXT 常见：textHeight；MTEXT 常见：height 或 textHeight
//   const h = ent.textHeight ?? ent.height ?? ent.nominalTextHeight;
//   return Number.isFinite(h) ? h : 10;
// }

// function getTextRotationRad(ent) {
//   // TEXT 常见 rotation；有些用 angle
//   const deg = ent.rotation ?? ent.angle ?? 0;
//   return ((Number.isFinite(deg) ? deg : 0) * Math.PI) / 180;
// }

// /**
//  * ===== 递归“展开”INSERT，返回扁平实体列表（带 worldMatrix 和 attributes）=====
//  * * @param {Array} entities - 当前层级的实体列表
//  * @param {Object} dxf - 完整的 dxf 对象（用于查找 blocks）
//  * @param {Object} parentMat - 父级变换矩阵
//  * @param {Array} stack - 防止循环引用的堆栈
//  * @param {Object} parentAttributes - [新增] 从父级 INSERT 继承下来的属性
//  */
// function explodeEntities(entities, dxf, parentMat = matIdentity(), stack = [], parentAttributes = {}) {
//   const out = [];
//   const blocks = buildBlockIndex(dxf);

//   for (const ent of entities || []) {
//     const t = (ent.type || "").toUpperCase();

//     if (t === "INSERT") {
//       const mInsBase = getInsertMatrix(ent);
//       if (!mInsBase) continue;

//       const blockName = ent.name;
//       const block = blocks.get(blockName);
//       if (!block || !Array.isArray(block.entities)) continue;
//       if (stack.includes(blockName)) continue;

//       // ===== [核心修改] 提取并合并属性 =====
//       // dxf-parser 通常将属性解析在 ent.attributes (对象) 或 ent.attribs (数组) 中
//       // 这里我们将其标准化为一个对象
//       let currentAttributes = {};

//       // 1. 如果有 attributes 对象 (key-value)
//       if (ent.attributes) {
//         currentAttributes = { ...ent.attributes };
//       }

//       // 2. 某些 parser 版本可能会有 attribs 数组，这里做一个兼容处理（可选）
//       // if (Array.isArray(ent.attribs)) {
//       //   ent.attribs.forEach(attr => {
//       //     if(attr.tag) currentAttributes[attr.tag] = attr.text || attr.value;
//       //   });
//       // }

//       // 3. 与父级属性合并（这样多层嵌套的块也能继承最外层的属性）
//       // 注意：子级属性优先覆盖父级，还是父级覆盖子级，取决于你的业务需求。
//       // 通常我们希望保留“最近”的属性，所以 currentAttributes 放后面。
//       const mergedAttributes = { ...parentAttributes, ...currentAttributes };

//       // ===== 处理 INSERT 阵列 =====
//       const cols = Number.isFinite(ent.columnCount) ? ent.columnCount : 1;
//       const rows = Number.isFinite(ent.rowCount) ? ent.rowCount : 1;
//       const colSp = Number.isFinite(ent.columnSpacing) ? ent.columnSpacing : 0;
//       const rowSp = Number.isFinite(ent.rowSpacing) ? ent.rowSpacing : 0;

//       for (let r = 0; r < rows; r++) {
//         for (let c = 0; c < cols; c++) {
//           const mArray = matTranslate(c * colSp, r * rowSp);
//           const mIns = matMul(mInsBase, mArray);
//           const worldMat = matMul(parentMat, mIns);

//           // 递归调用时，传入 mergedAttributes
//           out.push(
//             ...explodeEntities(
//               block.entities,
//               dxf,
//               worldMat,
//               [...stack, blockName],
//               mergedAttributes // <--- 传递属性
//             )
//           );
//         }
//       }
//       continue;
//     }

//     // 非 INSERT：是具体的几何图形（Line, Circle等）
//     // 将当前积累的 attributes 挂载到返回对象上
//     out.push({
//       ent,
//       worldMat: parentMat,
//       attributes: parentAttributes // <--- 挂载属性
//     });
//   }

//   return out;
// }

// function asPoint(p) {
//   const x = p?.x;
//   const y = p?.y;
//   if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
//   return { x, y };
// }

// function safeWorldToCanvas(p, tf, canvasH) {
//   const pt = asPoint(p);
//   if (!pt) return null;
//   const x = (pt.x - tf.bounds.minX) * tf.scale + tf.offsetX;
//   const y = canvasH - ((pt.y - tf.bounds.minY) * tf.scale + tf.offsetY);
//   return { x, y };
// }

// function getTextInsert(ent) {
//   // 不同 parser 版本字段可能不同，做兼容
//   return (
//     asPoint(ent.startPoint) ||
//     asPoint(ent.position) ||
//     asPoint(ent.insert) || // 有的会叫 insert
//     asPoint(ent.insertionPoint) || // 有的会叫 insertionPoint
//     null
//   );
// }

// /** ===== 坐标/几何工具 ===== */
// function expandBounds(b, p) {
//   const pt = asPoint(p);
//   if (!pt) return b;
//   if (pt.x < b.minX) b.minX = pt.x;
//   if (pt.x > b.maxX) b.maxX = pt.x;
//   if (pt.y < b.minY) b.minY = pt.y;
//   if (pt.y > b.maxY) b.maxY = pt.y;
//   return b;
// }

// function getEntityBounds(ent, b) {
//   const t = (ent.type || "").toUpperCase();

//   if (t === "LINE") {
//     expandBounds(b, ent.start);
//     expandBounds(b, ent.end);
//   } else if (t === "LWPOLYLINE" || t === "POLYLINE") {
//     for (const v of ent.vertices || []) expandBounds(b, v);
//   } else if (t === "CIRCLE" || t === "ARC") {
//     const c = asPoint(ent.center);
//     const r = ent.radius;
//     if (c && Number.isFinite(r)) {
//       expandBounds(b, { x: c.x - r, y: c.y - r });
//       expandBounds(b, { x: c.x + r, y: c.y + r });
//     }
//   } else if (t === "TEXT" || t === "MTEXT") {
//     const ins = getTextInsert(ent);
//     expandBounds(b, ins);
//   }

//   return b;
// }

// function computeBoundsFromDxf(dxf) {
//   const flat = explodeEntities(dxf.entities || [], dxf, matIdentity());

//   const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

//   for (const { ent, worldMat } of flat) {
//     const t = (ent.type || "").toUpperCase();

//     if (t === "LINE") {
//       expandBounds(b, applyMatToPoint(worldMat, ent.start));
//       expandBounds(b, applyMatToPoint(worldMat, ent.end));
//     } else if (t === "LWPOLYLINE" || t === "POLYLINE") {
//       for (const v of ent.vertices || []) expandBounds(b, applyMatToPoint(worldMat, v));
//     } else if (t === "CIRCLE" || t === "ARC") {
//       const c = applyMatToPoint(worldMat, ent.center);
//       const r = ent.radius;
//       // 含非均匀缩放时圆会变椭圆，这里 bounds 先用“最大缩放”近似
//       const sx = Math.hypot(worldMat.a, worldMat.b);
//       const sy = Math.hypot(worldMat.c, worldMat.d);
//       const rr = Number.isFinite(r) ? r * Math.max(sx, sy) : null;
//       if (c && rr != null) {
//         expandBounds(b, { x: c.x - rr, y: c.y - rr });
//         expandBounds(b, { x: c.x + rr, y: c.y + rr });
//       }
//     } else if (t === "TEXT" || t === "MTEXT") {
//       const ins = applyMatToPoint(worldMat, getTextInsert2(ent));
//       expandBounds(b, ins);
//     } else if (t === "ATTDEF") {
//       const ins = applyMatToPoint(worldMat, getAttdefInsert(ent));
//       expandBounds(b, ins);
//     } else if (t === "SOLID") {
//       const pts = getSolidPoints(ent);
//       if (!pts) continue;
//       for (const p of pts) expandBounds(b, applyMatToPoint(worldMat, p));
//     } else if (t === "POINT") {
//       const p = applyMatToPoint(worldMat, ent.position || ent.point || ent);
//       expandBounds(b, p);
//     }
//   }

//   if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
//   if (b.maxX - b.minX === 0) b.maxX = b.minX + 1;
//   if (b.maxY - b.minY === 0) b.maxY = b.minY + 1;
//   return b;
// }

// function makeTransform(bounds, canvasW, canvasH, padding = 24) {
//   const worldW = bounds.maxX - bounds.minX;
//   const worldH = bounds.maxY - bounds.minY;

//   const availW = Math.max(1, canvasW - padding * 2);
//   const availH = Math.max(1, canvasH - padding * 2);

//   const scale = Math.min(availW / worldW, availH / worldH);

//   // DXF 通常 Y 轴向上，Canvas Y 向下，所以需要翻转
//   // 映射：x' = (x - minX)*scale + offsetX
//   //      y' = canvasH - ((y - minY)*scale + offsetY)
//   const drawW = worldW * scale;
//   const drawH = worldH * scale;

//   const offsetX = padding + (availW - drawW) / 2;
//   const offsetY = padding + (availH - drawH) / 2;

//   return { scale, offsetX, offsetY, bounds };
// }

// function worldToCanvas(pt, tf, canvasH) {
//   const x = (pt.x - tf.bounds.minX) * tf.scale + tf.offsetX;
//   const y = canvasH - ((pt.y - tf.bounds.minY) * tf.scale + tf.offsetY);
//   return { x, y };
// }

// function degToRad(d) {
//   return (d * Math.PI) / 180;
// }

// function clearCanvas(ctx, w, h) {
//   ctx.setTransform(1, 0, 0, 1, 0, 0);
//   ctx.clearRect(0, 0, w, h);
// }

// /** ===== 绘制实体 ===== */
// function drawEntities(ctx, dxf, tf, canvasW, canvasH) {
//   // 在 drawEntities 最开始
//   const unsupported = new Map();

//   ctx.save();
//   ctx.lineWidth = 1;
//   ctx.strokeStyle = "#111";
//   ctx.fillStyle = "#111";

//   const flat = explodeEntities(dxf.entities || [], dxf, matIdentity());

//   for (const { ent, worldMat } of flat) {
//     const t = (ent.type || "").toUpperCase();

//     console.log("实体的属性:", ent?.attributes);

//     // 根据类型过滤
//     if (["TEXT", "MTEXT"].includes(t)) continue;

//     if (t === "LINE") {
//       const p1w = applyMatToPoint(worldMat, ent.start);
//       const p2w = applyMatToPoint(worldMat, ent.end);
//       const p1 = safeWorldToCanvas(p1w, tf, canvasH);
//       const p2 = safeWorldToCanvas(p2w, tf, canvasH);
//       if (!p1 || !p2) continue;
//       ctx.beginPath();
//       ctx.moveTo(p1.x, p1.y);
//       ctx.lineTo(p2.x, p2.y);
//       ctx.stroke();
//     } else if (t === "LWPOLYLINE" || t === "POLYLINE") {
//       const vsRaw = ent.vertices || [];
//       if (vsRaw.length < 2) continue;

//       // 先把 vertex 取点（世界坐标）
//       const verts = vsRaw.map((v) => asPoint(v)).filter(Boolean);
//       if (verts.length < 2) continue;

//       const closed = ent.shape === true || ent.closed === true;

//       ctx.beginPath();

//       // 从第一个点开始
//       {
//         const p0w = applyMatToPoint(worldMat, verts[0]);
//         const p0 = safeWorldToCanvas(p0w, tf, canvasH);
//         if (!p0) continue;
//         ctx.moveTo(p0.x, p0.y);
//       }

//       const segCount = closed ? verts.length : verts.length - 1;

//       for (let i = 0; i < segCount; i++) {
//         const v1 = verts[i];
//         const v2 = verts[(i + 1) % verts.length];

//         // bulge 字段一般挂在 v1 上（表示 v1->v2 这一段）
//         const bulge = Number.isFinite(vsRaw[i]?.bulge) ? vsRaw[i].bulge : 0;

//         if (bulge && Math.abs(bulge) > 1e-9) {
//           const arcPts = bulgeToPoints(v1, v2, bulge, 20);
//           for (let k = 1; k < arcPts.length; k++) {
//             const pw = applyMatToPoint(worldMat, arcPts[k]);
//             const pc = safeWorldToCanvas(pw, tf, canvasH);
//             if (pc) ctx.lineTo(pc.x, pc.y);
//           }
//         } else {
//           const p2w = applyMatToPoint(worldMat, v2);
//           const p2 = safeWorldToCanvas(p2w, tf, canvasH);
//           if (p2) ctx.lineTo(p2.x, p2.y);
//         }
//       }

//       if (closed) ctx.closePath();
//       ctx.stroke();
//     } else if (t === "CIRCLE") {
//       const cw = applyMatToPoint(worldMat, ent.center);
//       const c = safeWorldToCanvas(cw, tf, canvasH);
//       const r0 = ent.radius;
//       if (!c || !Number.isFinite(r0)) continue;

//       // 处理缩放：取矩阵最大尺度近似
//       const sx = Math.hypot(worldMat.a, worldMat.b);
//       const sy = Math.hypot(worldMat.c, worldMat.d);
//       const r = r0 * Math.max(sx, sy) * tf.scale;

//       ctx.beginPath();
//       ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
//       ctx.stroke();
//     } else if (t === "ARC") {
//       const cw = applyMatToPoint(worldMat, ent.center);
//       const c = safeWorldToCanvas(cw, tf, canvasH);
//       const r0 = ent.radius;
//       const sa = ent.startAngle;
//       const ea = ent.endAngle;
//       if (!c || !Number.isFinite(r0) || !Number.isFinite(sa) || !Number.isFinite(ea)) continue;

//       const sx = Math.hypot(worldMat.a, worldMat.b);
//       const sy = Math.hypot(worldMat.c, worldMat.d);
//       const r = r0 * Math.max(sx, sy) * tf.scale;

//       // Y 翻转：角度取负
//       const startC = -((sa * Math.PI) / 180);
//       const endC = -((ea * Math.PI) / 180);

//       ctx.beginPath();
//       ctx.arc(c.x, c.y, r, startC, endC, true);
//       ctx.stroke();
//     } else if (t === "TEXT" || t === "MTEXT") {
//       let text = getTextRaw(ent);
//       if (!text) continue;
//       if (t === "MTEXT") text = normalizeMText(text);

//       const insW = applyMatToPoint(worldMat, getTextInsert2(ent));
//       const p = safeWorldToCanvas(insW, tf, canvasH);
//       if (!p) continue;

//       // 字高 + 缩放（worldMat 的尺度 * tf.scale）
//       const h = getTextHeight(ent);
//       const sx = Math.hypot(worldMat.a, worldMat.b);
//       const sy = Math.hypot(worldMat.c, worldMat.d);
//       const fontPx = Math.max(8, h * Math.max(sx, sy) * tf.scale);

//       // 旋转：实体自带 rotation + INSERT 旋转（从 worldMat 中取角度）
//       const entRot = getTextRotationRad(ent);
//       const blockRot = Math.atan2(worldMat.b, worldMat.a); // worldMat 的旋转分量
//       // Canvas 已做 Y 翻转，所以这里角度也取负，让视觉更符合 DXF
//       const rot = -(entRot + blockRot);

//       ctx.save();
//       ctx.translate(p.x, p.y);
//       ctx.rotate(rot);
//       ctx.font = `${fontPx}px Arial`;
//       ctx.textBaseline = "alphabetic";

//       // 多行（MTEXT \P）
//       const lines = String(text).split("\n");
//       const lineH = fontPx * 1.2;

//       for (let i = 0; i < lines.length; i++) {
//         ctx.fillText(lines[i], 0, i * lineH);
//       }

//       ctx.restore();
//     } else if (t === "ATTDEF") {
//       const text = getAttdefText(ent);
//       if (!text) continue;

//       const insW = applyMatToPoint(worldMat, getAttdefInsert(ent));
//       const p = safeWorldToCanvas(insW, tf, canvasH);
//       if (!p) continue;

//       const h = getTextHeight(ent); // 你已有的函数
//       const sx = Math.hypot(worldMat.a, worldMat.b);
//       const sy = Math.hypot(worldMat.c, worldMat.d);
//       const fontPx = Math.max(8, h * Math.max(sx, sy) * tf.scale);

//       const entRot = getTextRotationRad(ent);
//       const blockRot = Math.atan2(worldMat.b, worldMat.a);
//       const rot = -(entRot + blockRot);

//       ctx.save();
//       ctx.translate(p.x, p.y);
//       ctx.rotate(rot);
//       ctx.font = `${fontPx}px Arial`;
//       ctx.fillText(text, 0, 0);
//       ctx.restore();
//     } else if (t === "SOLID") {
//       const pts = getSolidPoints(ent);
//       if (!pts) continue;

//       const pcs = pts.map((p) => safeWorldToCanvas(applyMatToPoint(worldMat, p), tf, canvasH)).filter(Boolean);

//       if (pcs.length < 3) continue;

//       ctx.beginPath();
//       ctx.moveTo(pcs[0].x, pcs[0].y);
//       for (let i = 1; i < pcs.length; i++) ctx.lineTo(pcs[i].x, pcs[i].y);
//       ctx.closePath();

//       // SOLID 通常代表“填充”，用 fill 更符合原意；也可以同时 stroke
//       ctx.fill();
//       // ctx.stroke(); // 需要边线就打开
//     } else if (t === "POINT") {
//       const pw = applyMatToPoint(worldMat, ent.position || ent.point || ent);
//       const p = safeWorldToCanvas(pw, tf, canvasH);
//       if (!p) continue;

//       const size = 2; // 像素大小
//       ctx.beginPath();
//       ctx.moveTo(p.x - size, p.y);
//       ctx.lineTo(p.x + size, p.y);
//       ctx.moveTo(p.x, p.y - size);
//       ctx.lineTo(p.x, p.y + size);
//       ctx.stroke();
//     } else {
//       unsupported.set(t, (unsupported.get(t) || 0) + 1);
//     }
//   }

//   ctx.restore();

//   // drawEntities 结束前：
//   if (unsupported.size) {
//     console.log(
//       "Unsupported entity types:",
//       [...unsupported.entries()].sort((a, b) => b[1] - a[1])
//     );
//   }
// }

// /** ====== 主组件 ====== */
// export default function CanvasViewer() {
//   const mainCanvasRef = useRef(null);

//   const [err, setErr] = useState("");
//   const [dxfText, setDxfText] = useState("");

//   const loadDemo = useCallback(async () => {
//     setErr("");
//     try {
//       const res = await fetch("/demo1.dxf");
//       if (!res.ok) throw new Error(`HTTP ${res.status}`);
//       setDxfText(await res.text());
//     } catch (e) {
//       setErr(`加载失败：${e.message}`);
//     }
//   }, []);

//   useEffect(() => {
//     loadDemo();
//   }, [loadDemo]);

//   useEffect(() => {
//     if (!dxfText) return;
//     const canvas = mainCanvasRef.current;
//     if (!canvas) return;
//     const ctx = canvas.getContext("2d");
//     if (!ctx) return;

//     try {
//       const parser = new DxfParser();
//       const dxf = parser.parseSync(dxfText);

//       const bounds = computeBoundsFromDxf(dxf);
//       const tf = makeTransform(bounds, canvas.width, canvas.height, 24);

//       clearCanvas(ctx, canvas.width, canvas.height);

//       console.log(
//         (dxf.entities || []).map((e) => ({
//           type: e.type,
//           keys: Object.keys(e || {}),
//           start: e.start,
//           end: e.end,
//           center: e.center,
//           verticesLen: e.vertices?.length
//         }))
//       );

//       // 背景网格（可选）
//       // drawGrid(ctx, canvas.width, canvas.height);

//       drawEntities(ctx, dxf, tf, canvas.width, canvas.height);
//       setErr("");
//     } catch (e) {
//       setErr(`解析/渲染失败：${e.message}`);
//       clearCanvas(ctx, canvas.width, canvas.height);
//     }
//   }, [dxfText]);

//   return (
//     <div className="viewerRoot">
//       {err && <div className="error">{err}</div>}
//       <div className="leftPane">
//         <canvas ref={mainCanvasRef} width={1200} height={900} className="canvas" />
//       </div>
//       <div className="detail" />
//     </div>
//   );
// }

import React, { useEffect, useRef, useState, useCallback } from "react";
import DxfParser from "dxf-parser";
import "./Canvas.css";

/** ================== 通用过滤：避免 paper space / viewport 造成巨大 bounds ================== */
function shouldSkipEntity(ent) {
  if (!ent || !ent.type) return true;

  // dxf-parser 常见字段：inPaperSpace
  if (ent.inPaperSpace === true) return true;

  const t = String(ent.type).toUpperCase();

  // 布局空间/视口经常把 bbox 拉爆
  if (t === "VIEWPORT") return true;

  return false;
}

/** ================== ATTRIB：从原始 DXF 文本中解析 INSERT->ATTRIB ================== */
function parseInsertAttribMapFromRaw(dxfText) {
  const map = new Map();
  if (!dxfText) return map;

  const lines = dxfText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let i = 0;

  const readPair = () => {
    if (i + 1 >= lines.length) return null;
    const code = lines[i].trim();
    const val = (lines[i + 1] || "").trim();
    i += 2;
    return { code, val };
  };

  let curInsertHandle = null;

  while (i < lines.length) {
    const pair = readPair();
    if (!pair) break;
    const { code, val } = pair;

    if (code === "0" && val === "INSERT") {
      curInsertHandle = null;

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
      continue;
    }
  }

  return map;
}

function getInsertHandle(ent) {
  return ent?.handle || ent?.id || ent?.dxf?.handle || ent?.objectId || null;
}

/** ===== 建 blocks 索引 ===== */
function buildBlockIndex(dxf) {
  const map = new Map();
  const b = dxf?.blocks;
  if (!b) return map;

  if (Array.isArray(b)) {
    for (const item of b) {
      if (item?.name) map.set(item.name, item);
    }
  } else {
    for (const k of Object.keys(b)) {
      const item = b[k];
      if (item?.name) map.set(item.name, item);
      else if (item?.entities) map.set(k, { name: k, ...item });
    }
  }

  return map;
}

/**
 * 把 attributes 挂到每个 INSERT 对象里：
 * ent.attributes = [{tag,text,position,textHeight,rotation}, ...]
 * 同时递归 blocks 内 INSERT
 */
function attachAttribToAllInserts(dxf, attribMap) {
  if (!dxf || !attribMap) return dxf;

  const blocks = buildBlockIndex(dxf);

  const attachOnList = (list) => {
    if (!Array.isArray(list)) return;
    for (const e of list) {
      if (!e || !e.type) continue;
      if (shouldSkipEntity(e)) continue;

      if (String(e.type).toUpperCase() === "INSERT") {
        const h = getInsertHandle(e);
        const attrs = h ? attribMap.get(h) : null;
        e.attributes = Array.isArray(attrs) ? attrs : [];
      }
    }
  };

  attachOnList(dxf.entities);

  for (const blk of blocks.values()) {
    attachOnList(blk?.entities);
  }

  return dxf;
}

/** ================== 你原来的几何/绘制工具（轻改） ================== */
function asPoint(p) {
  const x = p?.x;
  const y = p?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function getAttdefText(ent) {
  const s = ent.text ?? ent.string ?? ent.value ?? ent.defaultValue ?? ent.prompt ?? ent.tag ?? "";
  return s == null ? "" : String(s);
}

function getAttdefInsert(ent) {
  return asPoint(ent.startPoint) || asPoint(ent.position) || asPoint(ent.insert) || asPoint(ent.insertionPoint) || null;
}

function getSolidPoints(ent) {
  const p1 = asPoint(ent.p1) || asPoint(ent.point1) || asPoint(ent.firstCorner);
  const p2 = asPoint(ent.p2) || asPoint(ent.point2) || asPoint(ent.secondCorner);
  const p3 = asPoint(ent.p3) || asPoint(ent.point3) || asPoint(ent.thirdCorner);
  const p4 = asPoint(ent.p4) || asPoint(ent.point4) || asPoint(ent.fourthCorner);
  const pts = [p1, p2, p3, p4].filter(Boolean);
  return pts.length >= 3 ? pts : null;
}

/** ===== 2D 仿射矩阵 ===== */
function matIdentity() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function bulgeToPoints(p1, p2, bulge, segments = 16) {
  const x1 = p1.x,
    y1 = p1.y;
  const x2 = p2.x,
    y2 = p2.y;
  const dx = x2 - x1,
    dy = y2 - y1;

  const chord = Math.hypot(dx, dy);
  if (!Number.isFinite(chord) || chord === 0) return [p1, p2];

  const theta = 4 * Math.atan(bulge);
  if (Math.abs(theta) < 1e-6) return [p1, p2];

  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  const ux = dx / chord,
    uy = dy / chord;
  const nx = -uy,
    ny = ux;

  const h = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4));
  const sign = bulge >= 0 ? 1 : -1;

  const cx = mx + sign * nx * h;
  const cy = my + sign * ny * h;

  const a1 = Math.atan2(y1 - cy, x1 - cx);
  const a2 = Math.atan2(y2 - cy, x2 - cx);

  let start = a1,
    end = a2;
  if (bulge > 0 && end < start) end += Math.PI * 2;
  if (bulge < 0 && end > start) end -= Math.PI * 2;

  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const ang = lerp(start, end, t);
    pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
  }
  return pts;
}

function matMul(m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f
  };
}
function matTranslate(tx, ty) {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}
function matScale(sx, sy) {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}
function matRotate(rad) {
  const cos = Math.cos(rad),
    sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}
function applyMatToPoint(m, p) {
  const pt = asPoint(p);
  if (!pt) return null;
  return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
}

function getInsertMatrix(ent) {
  const pos = asPoint(ent.position) || asPoint(ent.insert) || asPoint(ent.insertionPoint);
  if (!pos) return null;

  const sx = Number.isFinite(ent.xScale) ? ent.xScale : 1;
  const sy = Number.isFinite(ent.yScale) ? ent.yScale : 1;
  const rotDeg = Number.isFinite(ent.rotation) ? ent.rotation : 0;

  const mS = matScale(sx, sy);
  const mR = matRotate((rotDeg * Math.PI) / 180);
  const mT = matTranslate(pos.x, pos.y);
  return matMul(mT, matMul(mR, mS));
}

function getTextRaw(ent) {
  const s = ent.text ?? ent.string ?? ent.value ?? "";
  return s == null ? "" : String(s);
}
function normalizeMText(s) {
  return s
    .replace(/\\P/g, "\n")
    .replace(/\\~+/g, " ")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/\\[A-Za-z][^;]*;/g, "")
    .trimEnd();
}
function getTextInsert2(ent) {
  return (
    asPoint(ent.position) ||
    asPoint(ent.startPoint) ||
    asPoint(ent.insert) ||
    asPoint(ent.insertionPoint) ||
    asPoint(ent.alignPoint) ||
    null
  );
}
function getTextHeight(ent) {
  const h = ent.textHeight ?? ent.height ?? ent.nominalTextHeight;
  return Number.isFinite(h) ? h : 10;
}
function getTextRotationRad(ent) {
  const deg = ent.rotation ?? ent.angle ?? 0;
  return ((Number.isFinite(deg) ? deg : 0) * Math.PI) / 180;
}

/**
 * ===== 递归展开 INSERT
 * 关键：过滤 paper space / viewport
 * 同时把 ent.attributes 展开为 type=ATTRIB 的 pseudo entity
 */
// function explodeEntities(entities, dxf, parentMat = matIdentity(), stack = []) {
//   const out = [];
//   const blocks = buildBlockIndex(dxf);

//   for (const ent of entities || []) {
//     if (!ent || !ent.type) continue;
//     if (shouldSkipEntity(ent)) continue;

//     const t = String(ent.type).toUpperCase();

//     if (t === "INSERT") {
//       // 先输出 INSERT 自带的 attributes（注意：position 通常已经是世界坐标）
//       if (Array.isArray(ent.attributes) && ent.attributes.length) {
//         for (const a of ent.attributes) {
//           const pos =
//             asPoint(a.position) || asPoint(ent.position) || asPoint(ent.insert) || asPoint(ent.insertionPoint) || null;

//           out.push({
//             ent: {
//               type: "ATTRIB",
//               tag: a.tag ?? "",
//               text: a.text ?? "",
//               position: pos,
//               textHeight: Number.isFinite(a.textHeight) ? a.textHeight : null,
//               rotation: Number.isFinite(a.rotation) ? a.rotation : null,
//               __fromInsertHandle: getInsertHandle(ent) || null
//             },
//             // ATTRIB position 通常是 WCS，所以 worldMat 用 parentMat
//             worldMat: parentMat
//           });
//         }
//       }

//       const mInsBase = getInsertMatrix(ent);
//       if (!mInsBase) continue;

//       const blockName = ent.name;
//       const block = blocks.get(blockName);
//       if (!block || !Array.isArray(block.entities)) continue;
//       if (stack.includes(blockName)) continue;

//       const cols = Number.isFinite(ent.columnCount) ? ent.columnCount : 1;
//       const rows = Number.isFinite(ent.rowCount) ? ent.rowCount : 1;
//       const colSp = Number.isFinite(ent.columnSpacing) ? ent.columnSpacing : 0;
//       const rowSp = Number.isFinite(ent.rowSpacing) ? ent.rowSpacing : 0;

//       for (let r = 0; r < rows; r++) {
//         for (let c = 0; c < cols; c++) {
//           const mArray = matTranslate(c * colSp, r * rowSp);
//           const mIns = matMul(mInsBase, mArray);
//           const worldMat = matMul(parentMat, mIns);
//           out.push(...explodeEntities(block.entities, dxf, worldMat, [...stack, blockName]));
//         }
//       }
//       continue;
//     }

//     out.push({ ent, worldMat: parentMat });
//   }

//   return out;
// }
/**
 * 递归打散实体，并将 INSERT 的属性注入到子实体的 attr 字段中
 * * @param {Array} entities - 当前层级的实体列表
 * @param {Object} dxf - 完整的 DXF 数据对象
 * @param {Array} parentMat - 父级变换矩阵
 * @param {Array} stack - 防止死循环的 Block 栈
 * @param {Object} parentAttrs - (新增) 从父级继承下来的属性键值对
 */
function explodeEntities(entities, dxf, parentMat = matIdentity(), stack = [], parentAttrs = {}) {
  const out = [];
  // 注意：如果性能敏感，建议将 buildBlockIndex 移到外部，作为参数传入，避免每次递归都重建索引
  const blocks = buildBlockIndex(dxf);

  for (const ent of entities || []) {
    if (!ent || !ent.type) continue;
    if (shouldSkipEntity(ent)) continue;

    const t = String(ent.type).toUpperCase();

    // ====== 1. 处理 INSERT (块引用) ======
    if (t === "INSERT") {
      // A. 提取当前 INSERT 的 attributes
      const currentAttrs = {};
      if (Array.isArray(ent.attributes)) {
        for (const a of ent.attributes) {
          if (a.tag) {
            // 将数组转为 KV 对象，例如 { "TAG": "P-101", "DESC": "泵" }
            currentAttrs[a.tag] = a.text;
          }
        }
      }

      // B. 属性合并：子级属性 覆盖 父级属性 (或者反之，看你需求)
      // 这里的 mergedAttrs 将会包含这一层以及上面所有层的属性
      const mergedAttrs = { ...parentAttrs, ...currentAttrs };

      // C. 计算矩阵
      const mInsBase = getInsertMatrix(ent);
      if (!mInsBase) continue;

      const blockName = ent.name;
      const block = blocks.get(blockName); // 假设 blocks Map 已经构建好
      if (!block || !Array.isArray(block.entities)) continue;

      // 防止循环引用
      if (stack.includes(blockName)) continue;

      // D. 处理阵列 (Row/Col)
      const cols = Number.isFinite(ent.columnCount) ? ent.columnCount : 1;
      const rows = Number.isFinite(ent.rowCount) ? ent.rowCount : 1;
      const colSp = Number.isFinite(ent.columnSpacing) ? ent.columnSpacing : 0;
      const rowSp = Number.isFinite(ent.rowSpacing) ? ent.rowSpacing : 0;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const mArray = matTranslate(c * colSp, r * rowSp);
          const mIns = matMul(mInsBase, mArray);
          const worldMat = matMul(parentMat, mIns);

          // E. 【关键】递归调用时，传入 mergedAttrs
          out.push(
            ...explodeEntities(
              block.entities,
              dxf,
              worldMat,
              [...stack, blockName],
              mergedAttrs // <--- 传递属性
            )
          );
        }
      }
      continue;
    }

    // ====== 2. 处理基础图元 (Line, Circle, Polyline 等) ======
    // 将累积的属性挂载到结果对象上的 attr 字段
    out.push({
      ent,
      worldMat: parentMat,
      attr: parentAttrs // <--- 这里！不再生成新对象，而是作为数据挂载
    });
  }

  return out;
}

function safeWorldToCanvas(p, tf, canvasH) {
  const pt = asPoint(p);
  if (!pt) return null;
  const x = (pt.x - tf.bounds.minX) * tf.scale + tf.offsetX;
  const y = canvasH - ((pt.y - tf.bounds.minY) * tf.scale + tf.offsetY);
  return { x, y };
}

function expandBounds(b, p) {
  const pt = asPoint(p);
  if (!pt) return b;
  if (pt.x < b.minX) b.minX = pt.x;
  if (pt.x > b.maxX) b.maxX = pt.x;
  if (pt.y < b.minY) b.minY = pt.y;
  if (pt.y > b.maxY) b.maxY = pt.y;
  return b;
}

function computeBoundsFromDxf(dxf) {
  // 这里 explodeEntities 内部已经过滤了 paper space / viewport
  const flat = explodeEntities(dxf.entities || [], dxf, matIdentity());

  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  for (const { ent, worldMat } of flat) {
    const t = String(ent.type || "").toUpperCase();

    if (t === "LINE") {
      expandBounds(b, applyMatToPoint(worldMat, ent.start));
      expandBounds(b, applyMatToPoint(worldMat, ent.end));
    } else if (t === "LWPOLYLINE" || t === "POLYLINE") {
      for (const v of ent.vertices || []) expandBounds(b, applyMatToPoint(worldMat, v));
    } else if (t === "CIRCLE" || t === "ARC") {
      const c = applyMatToPoint(worldMat, ent.center);
      const r = ent.radius;
      const sx = Math.hypot(worldMat.a, worldMat.b);
      const sy = Math.hypot(worldMat.c, worldMat.d);
      const rr = Number.isFinite(r) ? r * Math.max(sx, sy) : null;
      if (c && rr != null) {
        expandBounds(b, { x: c.x - rr, y: c.y - rr });
        expandBounds(b, { x: c.x + rr, y: c.y + rr });
      }
    } else if (t === "TEXT" || t === "MTEXT") {
      const insW = applyMatToPoint(worldMat, getTextInsert2(ent));
      expandBounds(b, insW);
    } else if (t === "ATTDEF") {
      const insW = applyMatToPoint(worldMat, getAttdefInsert(ent));
      expandBounds(b, insW);
    } else if (t === "ATTRIB") {
      const insW = applyMatToPoint(worldMat, ent.position);
      expandBounds(b, insW);
    } else if (t === "SOLID") {
      const pts = getSolidPoints(ent);
      if (!pts) continue;
      for (const p of pts) expandBounds(b, applyMatToPoint(worldMat, p));
    } else if (t === "POINT") {
      const p = applyMatToPoint(worldMat, ent.position || ent.point || ent);
      expandBounds(b, p);
    }
  }

  if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  if (b.maxX - b.minX === 0) b.maxX = b.minX + 1;
  if (b.maxY - b.minY === 0) b.maxY = b.minY + 1;
  return b;
}

function makeTransform(bounds, canvasW, canvasH, padding = 24) {
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;

  const availW = Math.max(1, canvasW - padding * 2);
  const availH = Math.max(1, canvasH - padding * 2);

  const scale = Math.min(availW / worldW, availH / worldH);

  const drawW = worldW * scale;
  const drawH = worldH * scale;

  const offsetX = padding + (availW - drawW) / 2;
  const offsetY = padding + (availH - drawH) / 2;

  return { scale, offsetX, offsetY, bounds };
}

function clearCanvas(ctx, w, h) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
}

function degToRad(d) {
  return (d * Math.PI) / 180;
}

/** ===== 绘制实体 ===== */
function drawEntities(ctx, dxf, tf, canvasW, canvasH) {
  const unsupported = new Map();

  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#111";
  ctx.fillStyle = "#111";

  console.log(`flat entities...`, dxf.entities);

  const flat = explodeEntities(dxf.entities || [], dxf, matIdentity());

  for (const { ent, worldMat, attr } of flat) {
    const t = String(ent.type || "").toUpperCase();

    console.log(`ent.`, ent, attr);

    if (Object.keys(attr || {}).length === 0) continue;
    if (["TEXT", "MTEXT", "ATTDEF", "ATTRIB"].includes(t)) continue;

    if (t === "LINE") {
      const p1w = applyMatToPoint(worldMat, ent.start);
      const p2w = applyMatToPoint(worldMat, ent.end);
      const p1 = safeWorldToCanvas(p1w, tf, canvasH);
      const p2 = safeWorldToCanvas(p2w, tf, canvasH);
      if (!p1 || !p2) continue;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    } else if (t === "LWPOLYLINE" || t === "POLYLINE") {
      const vsRaw = ent.vertices || [];
      if (vsRaw.length < 2) continue;

      const verts = vsRaw.map((v) => asPoint(v)).filter(Boolean);
      if (verts.length < 2) continue;

      const closed = ent.shape === true || ent.closed === true;

      ctx.beginPath();

      const p0w = applyMatToPoint(worldMat, verts[0]);
      const p0 = safeWorldToCanvas(p0w, tf, canvasH);
      if (!p0) continue;
      ctx.moveTo(p0.x, p0.y);

      const segCount = closed ? verts.length : verts.length - 1;

      for (let i = 0; i < segCount; i++) {
        const v1 = verts[i];
        const v2 = verts[(i + 1) % verts.length];
        const bulge = Number.isFinite(vsRaw[i]?.bulge) ? vsRaw[i].bulge : 0;

        if (bulge && Math.abs(bulge) > 1e-9) {
          const arcPts = bulgeToPoints(v1, v2, bulge, 20);
          for (let k = 1; k < arcPts.length; k++) {
            const pw = applyMatToPoint(worldMat, arcPts[k]);
            const pc = safeWorldToCanvas(pw, tf, canvasH);
            if (pc) ctx.lineTo(pc.x, pc.y);
          }
        } else {
          const p2w = applyMatToPoint(worldMat, v2);
          const p2 = safeWorldToCanvas(p2w, tf, canvasH);
          if (p2) ctx.lineTo(p2.x, p2.y);
        }
      }

      if (closed) ctx.closePath();
      ctx.stroke();
    } else if (t === "CIRCLE") {
      const cw = applyMatToPoint(worldMat, ent.center);
      const c = safeWorldToCanvas(cw, tf, canvasH);
      const r0 = ent.radius;
      if (!c || !Number.isFinite(r0)) continue;

      const sx = Math.hypot(worldMat.a, worldMat.b);
      const sy = Math.hypot(worldMat.c, worldMat.d);
      const r = r0 * Math.max(sx, sy) * tf.scale;

      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (t === "ARC") {
      const cw = applyMatToPoint(worldMat, ent.center);
      const c = safeWorldToCanvas(cw, tf, canvasH);
      const r0 = ent.radius;
      const sa = ent.startAngle;
      const ea = ent.endAngle;
      if (!c || !Number.isFinite(r0) || !Number.isFinite(sa) || !Number.isFinite(ea)) continue;

      const sx = Math.hypot(worldMat.a, worldMat.b);
      const sy = Math.hypot(worldMat.c, worldMat.d);
      const r = r0 * Math.max(sx, sy) * tf.scale;

      const startC = -degToRad(sa);
      const endC = -degToRad(ea);

      ctx.beginPath();
      ctx.arc(c.x, c.y, r, startC, endC, true);
      ctx.stroke();
    } else if (t === "ATTDEF") {
      const text = getAttdefText(ent);
      if (!text) continue;

      const insW = applyMatToPoint(worldMat, getAttdefInsert(ent));
      const p = safeWorldToCanvas(insW, tf, canvasH);
      if (!p) continue;

      const h = getTextHeight(ent);
      const sx = Math.hypot(worldMat.a, worldMat.b);
      const sy = Math.hypot(worldMat.c, worldMat.d);
      const fontPx = Math.max(8, h * Math.max(sx, sy) * tf.scale);

      const entRot = getTextRotationRad(ent);
      const blockRot = Math.atan2(worldMat.b, worldMat.a);
      const rot = -(entRot + blockRot);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(rot);
      ctx.font = `${fontPx}px Arial`;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    } else if (t === "ATTRIB") {
      // 绘制 INSERT 的属性文字
      let text = ent.text ?? "";
      text = text == null ? "" : String(text);
      if (!text) continue;

      const insW = applyMatToPoint(worldMat, ent.position);
      const p = safeWorldToCanvas(insW, tf, canvasH);
      if (!p) continue;

      const h = Number.isFinite(ent.textHeight) ? ent.textHeight : 10;
      const sx = Math.hypot(worldMat.a, worldMat.b);
      const sy = Math.hypot(worldMat.c, worldMat.d);
      const fontPx = Math.max(8, h * Math.max(sx, sy) * tf.scale);

      const entRot = degToRad(Number.isFinite(ent.rotation) ? ent.rotation : 0);
      const blockRot = Math.atan2(worldMat.b, worldMat.a);
      const rot = -(entRot + blockRot);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(rot);
      ctx.font = `${fontPx}px Arial`;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    } else if (t === "SOLID") {
      const pts = getSolidPoints(ent);
      if (!pts) continue;

      const pcs = pts.map((p) => safeWorldToCanvas(applyMatToPoint(worldMat, p), tf, canvasH)).filter(Boolean);
      if (pcs.length < 3) continue;

      ctx.beginPath();
      ctx.moveTo(pcs[0].x, pcs[0].y);
      for (let i = 1; i < pcs.length; i++) ctx.lineTo(pcs[i].x, pcs[i].y);
      ctx.closePath();
      ctx.fill();
    } else if (t === "POINT") {
      const pw = applyMatToPoint(worldMat, ent.position || ent.point || ent);
      const p = safeWorldToCanvas(pw, tf, canvasH);
      if (!p) continue;

      const size = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - size, p.y);
      ctx.lineTo(p.x + size, p.y);
      ctx.moveTo(p.x, p.y - size);
      ctx.lineTo(p.x, p.y + size);
      ctx.stroke();
    } else {
      unsupported.set(t, (unsupported.get(t) || 0) + 1);
    }
  }

  ctx.restore();

  if (unsupported.size) {
    console.log(
      "Unsupported entity types:",
      [...unsupported.entries()].sort((a, b) => b[1] - a[1])
    );
  }
}

/** ================== 主组件 ================== */
export default function CanvasViewer() {
  const mainCanvasRef = useRef(null);

  const [err, setErr] = useState("");
  const [dxfText, setDxfText] = useState("");

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

  useEffect(() => {
    if (!dxfText) return;
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      const parser = new DxfParser();

      // 1) 解析 raw ATTRIB
      const attribMap = parseInsertAttribMapFromRaw(dxfText);

      // 2) parse DXF
      const dxf = parser.parseSync(dxfText);

      // 3) attach attributes to INSERT
      attachAttribToAllInserts(dxf, attribMap);

      // 4) bounds（已过滤 paper space / viewport）
      const bounds = computeBoundsFromDxf(dxf);

      // 你可以打开这行看是否还是巨大范围
      // console.log("BOUNDS:", bounds);

      const tf = makeTransform(bounds, canvas.width, canvas.height, 24);

      clearCanvas(ctx, canvas.width, canvas.height);
      drawEntities(ctx, dxf, tf, canvas.width, canvas.height);
      setErr("");
    } catch (e) {
      setErr(`解析/渲染失败：${e.message}`);
      clearCanvas(ctx, canvas.width, canvas.height);
    }
  }, [dxfText]);

  return (
    <div className="viewerRoot">
      {err && <div className="error">{err}</div>}
      <div className="leftPane">
        <canvas ref={mainCanvasRef} width={1200} height={900} className="canvas" />
      </div>
      <div className="detail" />
    </div>
  );
}
