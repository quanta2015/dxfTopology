import * as THREE from "three";

export function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
    if (child.type === "Sprite" && child.material?.map) {
      child.material.map.dispose();
    }
  });
}

export function createLine(points, color, linewidth = 1) {
  if (!points || points.length < 2) return null;
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color, linewidth });
  return new THREE.Line(geom, mat);
}

export function getColor(entity, tables) {
  if (typeof entity.color === "number" && entity.color > 0) {
    if (entity.color > 0xffffff) return 0xffffff;
    return entity.color;
  }
  const layerName = entity.layer;
  const layer = tables?.layers?.[layerName];
  if (layer && typeof layer.color === "number" && layer.color > 0) {
    if (layer.color > 0xffffff) return 0xffffff;
    return layer.color;
  }
  return 0xffffff;
}

export function drawEntity(entity, tables, isTopLevel = false, parentColor = null) {
  if (entity?.visible === false) return null;

  const group = new THREE.Group();
  let color = getColor(entity, tables);

  if (
    parentColor !== null &&
    (entity.layer === "0" || entity.layer === 0) &&
    (entity.color === undefined || entity.color === 0)
  ) {
    color = parentColor;
  }

  const userData = {
    id: entity.handle,
    layer: entity.layer,
    type: entity.type,
    name: entity.name,
    attributes: entity.attributes,
    baseColor: color,
    isTopLevel
  };

  const addLineFromVertices = (verts, closed = false) => {
    const pts = (verts || [])
      .filter((v) => v && typeof v.x === "number" && typeof v.y === "number")
      .map((v) => new THREE.Vector3(v.x, v.y, v.z || 0));
    if (closed && pts.length > 2) pts.push(pts[0].clone());
    const line = createLine(pts, color);
    if (line) {
      line.userData = { ...userData };
      group.add(line);
    }
  };

  switch (entity.type) {
    case "LINE": {
      const sx = entity.start?.x ?? entity.vertices?.[0]?.x;
      const sy = entity.start?.y ?? entity.vertices?.[0]?.y;
      const ex = entity.end?.x ?? entity.vertices?.[1]?.x;
      const ey = entity.end?.y ?? entity.vertices?.[1]?.y;
      if (typeof sx === "number" && typeof ex === "number") {
        const line = createLine([new THREE.Vector3(sx, sy || 0, 0), new THREE.Vector3(ex, ey || 0, 0)], color);
        if (line) {
          line.userData = { ...userData };
          group.add(line);
        }
      }
      break;
    }

    case "LWPOLYLINE":
    case "POLYLINE":
      if (Array.isArray(entity.vertices)) {
        addLineFromVertices(entity.vertices, entity.closed || entity.shape);
      }
      break;

    case "CIRCLE": {
      const c = entity.center;
      if (c && typeof c.x === "number") {
        const curve = new THREE.EllipseCurve(c.x, c.y, entity.radius, entity.radius, 0, Math.PI * 2);
        const pts = curve.getPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0));
        const line = createLine(pts, color);
        if (line) {
          line.userData = { ...userData };
          group.add(line);
        }
      }
      break;
    }

    case "ARC": {
      const c = entity.center;
      if (c && typeof c.x === "number") {
        const sA = (entity.startAngle || 0) * (Math.PI / 180);
        const eA = (entity.endAngle || 0) * (Math.PI / 180);
        const curve = new THREE.EllipseCurve(c.x, c.y, entity.radius, entity.radius, sA, eA);
        const pts = curve.getPoints(48).map((p) => new THREE.Vector3(p.x, p.y, 0));
        const line = createLine(pts, color);
        if (line) {
          line.userData = { ...userData };
          group.add(line);
        }
      }
      break;
    }

    case "INSERT": {
      const block = tables.blocks?.[entity.name];
      if (block?.entities?.length) {
        const blockGroup = new THREE.Group();
        block.entities.forEach((child) => {
          const obj = drawEntity(child, tables, false, color);
          if (obj) blockGroup.add(obj);
        });

        const pos = entity.position || { x: entity.x || 0, y: entity.y || 0, z: 0 };
        blockGroup.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
        blockGroup.rotation.z = (entity.rotation || 0) * (Math.PI / 180);
        blockGroup.scale.set(entity.xscale || entity.xScale || 1, entity.yscale || entity.yScale || 1, 1);
        blockGroup.userData = { ...userData, baseColor: color, isTopLevel };
        group.add(blockGroup);
      }
      break;
    }

    case "TEXT":
    case "MTEXT": {
      if (!entity.text) break;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const fontSize = 64;
      ctx.font = `${fontSize}px Arial, "Microsoft YaHei", sans-serif`;
      const metrics = ctx.measureText(entity.text);

      canvas.width = Math.ceil(metrics.width || 1);
      canvas.height = Math.ceil(fontSize * 1.2);

      ctx.font = `${fontSize}px Arial, "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = "#" + new THREE.Color(color).getHexString();
      ctx.textBaseline = "middle";
      ctx.fillText(entity.text, 0, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;

      const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
      const sprite = new THREE.Sprite(mat);

      const h = entity.height || 10;
      const asp = canvas.width / canvas.height;
      sprite.scale.set(h * asp, h, 1);

      const pos = entity.position || entity.startPoint;
      sprite.position.set(pos?.x || 0, pos?.y || 0, pos?.z || 0);
      sprite.userData = { ...userData };
      group.add(sprite);
      break;
    }

    default:
      break;
  }

  return group.children.length ? group : null;
}

export function getRobustBoundsFromLines(root, lowQ = 0.02, highQ = 0.98) {
  const xs = [];
  const ys = [];
  const zs = [];

  // 深度遍历所有子对象，确保嵌套块（INSERT）内的线段也被收集
  root.traverse((o) => {
    // 明确判断线段类型，兼容Three.js不同版本
    if (o.isLine || o.isLineSegments) {
      const posAttr = o.geometry?.attributes?.position;
      if (!posAttr) return;

      // 遍历所有顶点，收集坐标
      for (let i = 0; i < posAttr.count; i++) {
        const worldPos = new THREE.Vector3();
        o.localToWorld(worldPos.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i) || 0)); // 转换为世界坐标，避免局部坐标偏移导致的边界错误

        const x = worldPos.x;
        const y = worldPos.y;
        const z = worldPos.z;
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          xs.push(x);
          ys.push(y);
          zs.push(z);
        }
      }
    }
  });

  // 无线段时回退到整体包围盒
  if (xs.length === 0) {
    const box = new THREE.Box3().setFromObject(root);
    return box.isEmpty() ? null : box;
  }

  // 分位计算逻辑不变，保持鲁棒性
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);

  const quantile = (arr, q) => {
    const n = arr.length;
    if (n === 1) return arr[0];
    const idx = (n - 1) * q;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return arr[lo];
    const t = idx - lo;
    return arr[lo] * (1 - t) + arr[hi] * t;
  };

  const minX = quantile(xs, lowQ);
  const maxX = quantile(xs, highQ);
  const minY = quantile(ys, lowQ);
  const maxY = quantile(ys, highQ);
  const minZ = quantile(zs, lowQ);
  const maxZ = quantile(zs, highQ);

  const fullMinX = xs[0],
    fullMaxX = xs[xs.length - 1];
  const fullMinY = ys[0],
    fullMaxY = ys[ys.length - 1];
  const fullMinZ = zs[0],
    fullMaxZ = zs[zs.length - 1];

  const safeMinX = Number.isFinite(minX) ? minX : fullMinX;
  const safeMaxX = Number.isFinite(maxX) ? maxX : fullMaxX;
  const safeMinY = Number.isFinite(minY) ? minY : fullMinY;
  const safeMaxY = Number.isFinite(maxY) ? maxY : fullMaxY;
  const safeMinZ = Number.isFinite(minZ) ? minZ : fullMinZ;
  const safeMaxZ = Number.isFinite(maxZ) ? maxZ : fullMaxZ;

  const dx = safeMaxX - safeMinX;
  const dy = safeMaxY - safeMinY;

  const useFull = !Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6);

  const box = new THREE.Box3(
    new THREE.Vector3(useFull ? fullMinX : safeMinX, useFull ? fullMinY : safeMinY, useFull ? fullMinZ : safeMinZ),
    new THREE.Vector3(useFull ? fullMaxX : safeMaxX, useFull ? fullMaxY : safeMaxY, useFull ? fullMaxZ : safeMaxZ)
  );

  return box.isEmpty() ? null : box;
}

export function normalizeRootToOriginByLines(root) {
  const box = getRobustBoundsFromLines(root, 0.02, 0.98);
  if (!box) return;
  const c = box.getCenter(new THREE.Vector3());
  // 打印移动前的中心和移动后的root位置
  // console.log("图形原中心：", c);
  // console.log("移动后root位置：", { x: -c.x, y: -c.y, z: -c.z });
  root.position.x -= c.x;
  root.position.y -= c.y;
  root.position.z -= c.z;
}

export function fitCameraToBox(root, camera, controls) {
  const box = getRobustBoundsFromLines(root, 0.02, 0.98);
  if (!box) return;

  // 1. 获取图形实际尺寸（保持原有逻辑）
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  // 2. 动态计算适配缩放（保持原有逻辑）
  const aspect = camera.right - camera.left;
  const viewHeight = camera.top - camera.bottom;
  const viewAspect = aspect / viewHeight;
  const objAspect = size.x / size.y || 1;

  let zoomX = (aspect * 0.85) / maxDim;
  let zoomY = (viewHeight * 0.85) / maxDim;
  if (objAspect > viewAspect) {
    zoomY = zoomX / objAspect;
  } else {
    zoomX = zoomY * objAspect;
  }
  const finalZoom = Math.min(zoomX, zoomY);

  // 🌟 核心修改：添加放大系数（大于1即可放大，按需调整，如1.5、2）
  const scaleFactor = 1.8; // 放大1.5倍，可改为2、3等
  const zoom = THREE.MathUtils.clamp(finalZoom * scaleFactor, 1e-9, 1e9);

  // 3. 保持原点对齐（不破坏之前的修复）
  camera.zoom = zoom;
  camera.position.set(0, 0, 1000);
  controls.target.set(0, 0, 0);

  camera.updateProjectionMatrix();
  controls.update();
}

/** 辅助函数：生成实体唯一key */
export function getEntityUniqueKey(userData) {
  // 组合type+layer+id，确保唯一不重复
  return `${userData.type}:${userData.layer || "default"}:${userData.id}`;
}

/**
 * 十进制颜色值转6位十六进制颜色字符串（不带#）
 * @param {number} colorDecimal - 颜色十进制值
 * @returns {string} - 6位十六进制字符串（如8421504转为"808080"）
 */
const decimalToHexColor = (colorDecimal) => {
  // 转为十六进制字符串 → 去除前缀 → 补零到6位 → 转大写
  return colorDecimal.toString(16).padStart(6, "0").toUpperCase();
};

/**
 * 判断颜色是否为纯红色（#ff0000）
 * @param {number} colorDecimal - 颜色十进制值
 * @returns {boolean}
 */
export const isRedColorByHex = (colorDecimal) => {
  const RED_HEX = "FF0000"; // 纯红色十六进制（大写）
  const BLUE_HEX = "00FFFF"; // 纯蓝色十六进制（大写）

  const colorHex = decimalToHexColor(colorDecimal);
  return colorHex === RED_HEX || colorHex === BLUE_HEX;
};

export function getEntityDisplayName(userData, blocks = {}) {
  // 1) 属性文本
  if (userData.attributes && Array.isArray(userData.attributes)) {
    const t = userData.attributes.find((a) => a.text)?.text?.trim();
    if (t) return t;
  }
  // 2) ATTDEF
  if (userData.type === "INSERT" && userData.name && blocks[userData.name]?.entities) {
    const attdef = blocks[userData.name].entities.find((e) => e.type === "ATTDEF" && e.text && e.text.trim());
    if (attdef?.text) return attdef.text.trim();
  }
  // 3) 块名
  if (userData.name) {
    return userData.name.replace(/^\$/, "").replace(/\$/, " ").replace(/_/g, " ").trim();
  }
  return userData.type || "实体";
}

/** 优化：生成类别唯一Key（LWPOLYLINE包含颜色，其他类型保持原有逻辑） */
export const getCategoryUniqueKey = (userData, name, color) => {
  const colorHex = "#" + color.toString(16).padStart(6, "0");
  // 对LWPOLYLINE/LINE，Key拼接颜色值；其他类型沿用原有逻辑
  if (userData.type === "LWPOLYLINE" || userData.type === "LINE") {
    return `${userData.type}:${name}:${colorHex}`;
  }
  return `${userData.type}:${name}`;
};

/** 判断字符串是否包含中文 */
export const isContainChinese = (str) => {
  if (!str) return false;
  const chineseReg = /[\u4e00-\u9fa5]/;
  return chineseReg.test(str);
};

// ====== 黄金色实线辅助框（Box3 -> 12条边 LineSegments） ======
export const makeDashedBoxHelper = (obj) => {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return null;

  const min = box.min;
  const max = box.max;

  const pts = [
    // bottom
    min.x,
    min.y,
    min.z,
    max.x,
    min.y,
    min.z,
    max.x,
    min.y,
    min.z,
    max.x,
    max.y,
    min.z,
    max.x,
    max.y,
    min.z,
    min.x,
    max.y,
    min.z,
    min.x,
    max.y,
    min.z,
    min.x,
    min.y,
    min.z,

    // top
    min.x,
    min.y,
    max.z,
    max.x,
    min.y,
    max.z,
    max.x,
    min.y,
    max.z,
    max.x,
    max.y,
    max.z,
    max.x,
    max.y,
    max.z,
    min.x,
    max.y,
    max.z,
    min.x,
    max.y,
    max.z,
    min.x,
    min.y,
    max.z,

    // vertical
    min.x,
    min.y,
    min.z,
    min.x,
    min.y,
    max.z,
    max.x,
    min.y,
    min.z,
    max.x,
    min.y,
    max.z,
    max.x,
    max.y,
    min.z,
    max.x,
    max.y,
    max.z,
    min.x,
    max.y,
    min.z,
    min.x,
    max.y,
    max.z
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));

  // 黄金色（你也可以换成 0xffd700 / 0xd4af37）
  const mat = new THREE.LineBasicMaterial({
    color: 0xd4af37
  });

  const line = new THREE.LineSegments(geo, mat);

  // 永远置顶显示（避免被 DXF 线挡住/闪烁）
  line.renderOrder = 999999;
  line.material.depthTest = false;
  line.material.depthWrite = false;

  line.userData.isHelper = true;
  return line;
};

//  工具：从 wire 对象里提取世界坐标线段
export const extractWorldSegments = (obj) => {
  const segs = [];
  obj.updateWorldMatrix(true, true);

  obj.traverse((child) => {
    if (!child.geometry || !child.geometry.attributes?.position) return;
    if (!child.isLine && !child.isLineSegments) return;

    const pos = child.geometry.attributes.position;
    const idx = child.geometry.index;
    const m = child.matrixWorld;

    const readV = (i) => {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      return v.applyMatrix4(m);
    };

    // LineSegments：成对(0-1,2-3...)
    const pushPairs = (indices) => {
      for (let i = 0; i + 1 < indices.length; i += 2) {
        const a = readV(indices[i]);
        const b = readV(indices[i + 1]);
        segs.push([a, b]);
      }
    };

    // Line：相邻(0-1,1-2...)
    const pushConsecutive = (indices) => {
      for (let i = 0; i + 1 < indices.length; i += 1) {
        const a = readV(indices[i]);
        const b = readV(indices[i + 1]);
        segs.push([a, b]);
      }
    };

    if (idx) {
      const indices = new Array(idx.count);
      for (let i = 0; i < idx.count; i++) indices[i] = idx.getX(i);
      if (child.isLineSegments) pushPairs(indices);
      else pushConsecutive(indices);
    } else {
      const indices = new Array(pos.count);
      for (let i = 0; i < pos.count; i++) indices[i] = i;
      if (child.isLineSegments) pushPairs(indices);
      else pushConsecutive(indices);
    }
  });

  return segs;
};

//  工具：线段与 Box 相交（允许误差 s）
export const segmentIntersectBox = (a, b, box, s) => {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-9) return null;

  dir.multiplyScalar(1 / len);

  const ray = new THREE.Ray(a, dir);
  const expanded = box.clone().expandByScalar(s);

  const hit = new THREE.Vector3();
  const ok = ray.intersectBox(expanded, hit);
  if (!ok) return null;

  // 确保交点在线段范围内
  const t = hit.clone().sub(a).dot(dir);
  if (t < -s || t > len + s) return null;

  return hit.clone();
};

//  工具：判定交点落在 box 的哪条“边/面”（用于“同一条边上”过滤）
export const classifyContact = (p, box, s) => {
  const candidates = [];

  const dxMin = Math.abs(p.x - box.min.x);
  const dxMax = Math.abs(p.x - box.max.x);
  const dyMin = Math.abs(p.y - box.min.y);
  const dyMax = Math.abs(p.y - box.max.y);
  const dzMin = Math.abs(p.z - box.min.z);
  const dzMax = Math.abs(p.z - box.max.z);

  if (dxMin <= s) candidates.push("xmin");
  if (dxMax <= s) candidates.push("xmax");
  if (dyMin <= s) candidates.push("ymin");
  if (dyMax <= s) candidates.push("ymax");
  if (dzMin <= s) candidates.push("zmin");
  if (dzMax <= s) candidates.push("zmax");

  if (candidates.length === 0) return { kind: "unknown", key: "unknown" };

  // 1个 => 在某个面上；2个 => 在某条边上；3个 => 在角上
  const kind = candidates.length === 1 ? "face" : candidates.length === 2 ? "edge" : "corner";
  const key = candidates.slice().sort().join("|");
  return { kind, key };
};

//  工具：创建紫色连线
export const makePurpleLink = (p1, p2) => {
  const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const mat = new THREE.LineBasicMaterial({ color: 0x8000ff });
  const line = new THREE.Line(geo, mat);

  line.renderOrder = 999998;
  line.material.depthTest = false;
  line.material.depthWrite = false;

  line.userData.isWireLink = true;
  return line;
};
