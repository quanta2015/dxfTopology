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

/** 辅助函数：生成实体友好显示名称 */
export function getEntityDisplayName(userData, blocks = {}) {
  if (userData.name && blocks[userData.name]) {
    return `${userData.type}-${userData.name}`;
  }
  if (userData.layer) {
    return `${userData.type}-${userData.layer}`;
  }
  return `${userData.type}-${userData.id.slice(0, 6)}`; // 用id前6位避免重复
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
  const colorHex = decimalToHexColor(colorDecimal);
  return colorHex === RED_HEX;
};
