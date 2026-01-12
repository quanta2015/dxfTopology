import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import DxfParser from "dxf-parser";
import "./Canvas.less";
import {
  drawEntity,
  disposeObject,
  normalizeRootToOriginByLines,
  fitCameraToBox,
  isRedColorByHex,
  getEntityDisplayName,
  getCategoryUniqueKey,
  isContainChinese,
  makeDashedBoxHelper,
  extractWorldSegments,
  segmentIntersectBox,
  classifyContact,
  makePurpleLink,
  segsTouch2D
} from "./helper.js";

// ====== 分组定义：4个集合（用于 radio），3个按钮控制显示 ======
const GROUPS = [
  { key: "panel", label: "配电箱" },
  { key: "component", label: "元件" },
  { key: "wire", label: "电线" },
  { key: "other", label: "其他" }
];

const LINK_CLOR = 0x800080; // 紫色

export default function CanvasViewer({ mode = "fill", width = 1600, height = 900 }) {
  const mountRef = useRef(null);
  const helperRootRef = useRef(null);
  const wireLinkRootRef = useRef(null);
  const idLabelRootRef = useRef(null); // ✅ ID 标签 root

  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);

  const dxfRootRef = useRef(null);
  const animRef = useRef(0);
  const roRef = useRef(null);

  const fittedOnceRef = useRef(false);
  const [menuIndex, setMenuIndex] = useState(0);

  const [err, setErr] = useState("");
  const [dxfText, setDxfText] = useState("");
  const [entityCategoryList, setEntityCategoryList] = useState([]);
  const [categoryGroupMap, setCategoryGroupMap] = useState(() => ({}));
  const [groupVisibility, setGroupVisibility] = useState(() => ({
    main: true, // panel + component
    wire: true,
    other: false
  }));

  // ✅ 路径结果（只用 ID，不用名称）
  // item: { ids: string[], length: number }
  const [routerPaths, setRouterPaths] = useState([]);

  const mountStyle = useMemo(() => {
    if (mode === "fixed") return { width: `${width}px`, height: `${height}px` };
    return { width: "100%", height: "100%" };
  }, [mode, width, height]);

  // ====== 将 4个集合映射到 3个按钮开关 ======
  const isGroupVisible = useCallback((groupKey, vis) => {
    if (groupKey === "panel" || groupKey === "component") return vis.main;
    if (groupKey === "wire") return vis.wire;
    return vis.other;
  }, []);

  // ====== 根据“类别所属集合 + 集合开关”批量更新可见性 ======
  const applyVisibilityByGroups = useCallback(
    (list, groupMap, vis) => {
      list.forEach((category) => {
        const groupKey = groupMap[category.key] || "other";
        const show = isGroupVisible(groupKey, vis);

        category.objects.forEach((obj) => {
          obj.visible = show;

          // 同步 helper
          if (obj.userData?.__boxHelper) obj.userData.__boxHelper.visible = show;

          // 同步 ID label
          if (obj.userData?.__idLabel) obj.userData.__idLabel.visible = show;
        });
      });
    },
    [isGroupVisible]
  );

  // ====== 类别行 radio 变更：重新归类 + 应用可见性 ======
  const handleCategoryGroupChange = useCallback(
    (categoryKey, nextGroupKey) => {
      setCategoryGroupMap((prev) => {
        const next = { ...prev, [categoryKey]: nextGroupKey };
        applyVisibilityByGroups(entityCategoryList, next, groupVisibility);
        return next;
      });
    },
    [applyVisibilityByGroups, entityCategoryList, groupVisibility]
  );

  // ====== 3 个按钮：切换集合显隐 ======
  const toggleGroupVisibility = useCallback(
    (which) => {
      setGroupVisibility((prev) => {
        const next = { ...prev, [which]: !prev[which] };
        applyVisibilityByGroups(entityCategoryList, categoryGroupMap, next);

        // 紫色连线跟随“电线”按钮显隐
        if (which === "wire" && wireLinkRootRef.current) {
          wireLinkRootRef.current.visible = next.wire;
        }

        return next;
      });
    },
    [applyVisibilityByGroups, entityCategoryList, categoryGroupMap]
  );

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

  // ====== three init / dispose ======
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x212121);
    sceneRef.current = scene;

    const camera = new THREE.OrthographicCamera(-500, 500, 500, -500, 1, 2_000_000);
    camera.position.set(0, 0, 1000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    renderer.domElement.style.cursor = "default";
    const onDown = () => (renderer.domElement.style.cursor = "grabbing");
    const onUp = () => (renderer.domElement.style.cursor = "default");
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);

    const applySize = () => {
      const rect = mount.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      if (!w || !h) return;

      const aspect = w / h;
      const viewSize = Math.max(w, h) / 2;
      camera.left = (-viewSize * aspect) / 2;
      camera.right = (viewSize * aspect) / 2;
      camera.top = viewSize / 2;
      camera.bottom = -viewSize / 2;
      camera.updateProjectionMatrix();

      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;

      controls.update();
    };

    applySize();

    if (mode === "fill") {
      const ro = new ResizeObserver(() => applySize());
      ro.observe(mount);
      roRef.current = ro;
    }

    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animRef.current);

      if (roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }

      window.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointerdown", onDown);

      if (wireLinkRootRef.current) {
        scene.remove(wireLinkRootRef.current);
        disposeObject(wireLinkRootRef.current);
        wireLinkRootRef.current = null;
      }

      if (idLabelRootRef.current) {
        scene.remove(idLabelRootRef.current);
        disposeObject(idLabelRootRef.current);
        idLabelRootRef.current = null;
      }

      if (helperRootRef.current) {
        scene.remove(helperRootRef.current);
        disposeObject(helperRootRef.current);
        helperRootRef.current = null;
      }

      if (dxfRootRef.current) {
        scene.remove(dxfRootRef.current);
        disposeObject(dxfRootRef.current);
        dxfRootRef.current = null;
      }

      fittedOnceRef.current = false;

      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }

      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, [mode]);

  // ====== render DXF when text changes ======
  useEffect(() => {
    if (!dxfText) return;
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;

    try {
      renderDxfFromText(dxfText);
      setErr("");
    } catch (e) {
      console.error(e);
      setErr(`解析失败：${e.message || String(e)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dxfText]);

  // 切出来的新“电线段”（红色体系）——加入统计用
  const makeGeneratedWireSegment = (a, b, srcWire) => {
    const geom = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const color = srcWire?.userData?.baseColor ?? 0xff0000;

    const mat = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geom, mat);

    line.userData = {
      ...(srcWire?.userData || {}),
      isTopLevel: true,
      type: "LINE",
      __generatedWireSegment: true
    };

    return line;
  };

  // ========= ID 生成：uuid -> 4位短ID（base36 递增，保证唯一）=========
  const makeUuidToShortId = () => {
    const map = new Map();
    let n = 0;
    const nextId = () => (n++).toString(36).padStart(4, "0").slice(-4);

    const get = (uuid) => {
      if (!uuid) return "0000";
      if (map.has(uuid)) return map.get(uuid);
      const id = nextId();
      map.set(uuid, id);
      return id;
    };

    return { get, map };
  };

  // ========= 生成文字 Sprite（用于图中显示 ID）=========
  const makeTextSprite = (text, opts = {}) => {
    const {
      fontSize = 72,
      padding = 12,
      bg = "rgba(0,0,0,0.55)",
      fg = "#ffffff",
      border = "rgba(255,255,255,0.15)",
      borderWidth = 2,
      scale = 1.0
    } = opts;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    ctx.font = `${fontSize}px Arial`;
    const metrics = ctx.measureText(text);
    const w = Math.ceil(metrics.width + padding * 2);
    const h = Math.ceil(fontSize + padding * 2);

    canvas.width = w;
    canvas.height = h;

    // background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // border
    if (borderWidth > 0) {
      ctx.strokeStyle = border;
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(borderWidth / 2, borderWidth / 2, w - borderWidth, h - borderWidth);
    }

    // text
    ctx.font = `${fontSize}px Arial`;
    ctx.fillStyle = fg;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, w / 2, h / 2 + 1);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);

    // 让 sprite 在世界坐标里看起来像“固定大小”的标签：正交相机下简单按像素映射
    const k = 0.6 * scale;
    sprite.scale.set(w * k, h * k, 1);

    return sprite;
  };

  // ========= 路由/路径计算：工具函数 =========
  const calcWireLength = (wireObj) => {
    const segs = extractWorldSegments(wireObj) || [];
    let sum = 0;
    for (const [a, b] of segs) sum += a.distanceTo(b);
    return sum;
  };

  // 用容差把点做 hash（用于 wire-wire 端点连接）
  const pointKey = (v, tol = 6) => {
    const x = Math.round(v.x / tol);
    const y = Math.round(v.y / tol);
    const z = Math.round(v.z / tol);
    return `${x},${y},${z}`;
  };

  // --- 2D 几何：线段相交（带容差），默认投影到 XY 平面 ---
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const distPointToSeg2D = (p, a, b) => {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby;
    if (ab2 <= 1e-12) {
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    const t = clamp01((apx * abx + apy * aby) / ab2);
    const cx = a.x + t * abx;
    const cy = a.y + t * aby;
    const dx = p.x - cx;
    const dy = p.y - cy;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  const onSeg = (a, b, p, eps) =>
    Math.min(a.x, b.x) - eps <= p.x &&
    p.x <= Math.max(a.x, b.x) + eps &&
    Math.min(a.y, b.y) - eps <= p.y &&
    p.y <= Math.max(a.y, b.y) + eps;

  const segsIntersect2D = (a, b, c, d, tol = 6) => {
    // bbox
    const minAx = Math.min(a.x, b.x) - tol;
    const maxAx = Math.max(a.x, b.x) + tol;
    const minAy = Math.min(a.y, b.y) - tol;
    const maxAy = Math.max(a.y, b.y) + tol;

    const minCx = Math.min(c.x, d.x) - tol;
    const maxCx = Math.max(c.x, d.x) + tol;
    const minCy = Math.min(c.y, d.y) - tol;
    const maxCy = Math.max(c.y, d.y) + tol;

    if (maxAx < minCx || maxCx < minAx || maxAy < minCy || maxCy < minAy) return false;

    const eps = 1e-9;
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);

    if ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) {
      if ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps)) return true;
    }

    if (Math.abs(o1) <= eps && onSeg(a, b, c, tol)) return true;
    if (Math.abs(o2) <= eps && onSeg(a, b, d, tol)) return true;
    if (Math.abs(o3) <= eps && onSeg(c, d, a, tol)) return true;
    if (Math.abs(o4) <= eps && onSeg(c, d, b, tol)) return true;

    if (distPointToSeg2D(a, c, d) <= tol) return true;
    if (distPointToSeg2D(b, c, d) <= tol) return true;
    if (distPointToSeg2D(c, a, b) <= tol) return true;
    if (distPointToSeg2D(d, a, b) <= tol) return true;

    return false;
  };

  const cellKey = (ix, iy) => `${ix},${iy}`;
  const segBBox2D = (a, b) => ({
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y)
  });

  const renderDxfFromText = (text) => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    // 清理旧 root
    if (dxfRootRef.current) {
      scene.remove(dxfRootRef.current);
      disposeObject(dxfRootRef.current);
      dxfRootRef.current = null;
    }

    // 清理旧 helpers
    if (helperRootRef.current) {
      scene.remove(helperRootRef.current);
      disposeObject(helperRootRef.current);
      helperRootRef.current = null;
    }

    // 清理旧 wire links
    if (wireLinkRootRef.current) {
      scene.remove(wireLinkRootRef.current);
      disposeObject(wireLinkRootRef.current);
      wireLinkRootRef.current = null;
    }

    // 清理旧 ID labels
    if (idLabelRootRef.current) {
      scene.remove(idLabelRootRef.current);
      disposeObject(idLabelRootRef.current);
      idLabelRootRef.current = null;
    }

    // 清理旧路径
    setRouterPaths([]);

    const parser = new DxfParser();
    const dxf = parser.parseSync(text);

    const tables = dxf.tables || {};
    const blocks = dxf.blocks || {};
    tables.blocks = blocks;
    tables.layers = dxf.tables?.layer?.layers ? dxf.tables.layer.layers : {};

    const root = new THREE.Group();
    (dxf.entities || []).forEach((ent) => {
      const obj = drawEntity(ent, tables, true, null);
      if (obj) root.add(obj);
    });

    normalizeRootToOriginByLines(root);
    scene.add(root);
    dxfRootRef.current = root;

    root.updateWorldMatrix(true, true);

    // ====== 1) 分类收集 ======
    const entityStats = {};
    const dxfBlocks = blocks;

    // 用于把“生成线段”塞回原 wire 的类别里
    const uuidToCategoryKey = new Map();

    root.traverse((obj) => {
      if (obj.userData && obj.userData.isTopLevel) {
        const userData = obj.userData;
        const name = getEntityDisplayName(userData, dxfBlocks);
        const color = userData.baseColor || 0xffffff;
        const categoryKey = getCategoryUniqueKey(userData, name, color);

        if (!entityStats[categoryKey]) {
          entityStats[categoryKey] = {
            key: categoryKey,
            name,
            type: userData.type,
            blockName: userData.name || "N/A",
            layer: userData.layer || "N/A",
            color,
            objects: [],
            count: 0
          };
        }

        entityStats[categoryKey].objects.push(obj);
        entityStats[categoryKey].count = entityStats[categoryKey].objects.length;

        uuidToCategoryKey.set(obj.uuid, categoryKey);
      }
    });

    const baseEntityCategoryList = Object.values(entityStats).sort((a, b) => b.count - a.count);

    // ====== 2) 初始化分组映射 ======
    const initialGroupMap = {};
    baseEntityCategoryList.forEach((category) => {
      let g = "other";

      if ((category.type === "LINE" || category.type === "LWPOLYLINE") && isRedColorByHex(category.color)) {
        g = "wire";
      } else if (isContainChinese(category.name)) {
        g = /配电箱|电箱|箱体|箱/.test(category.name) ? "panel" : "component";
      } else {
        g = "other";
      }

      initialGroupMap[category.key] = g;
    });

    // ====== 3) 创建辅助框（仅 panel/component；wire/other 不创建） ======
    const helperRoot = new THREE.Group();
    helperRoot.name = "__helpers__";

    root.updateWorldMatrix(true, true);

    baseEntityCategoryList.forEach((category) => {
      const groupKey = initialGroupMap[category.key] || "other";
      if (groupKey === "wire" || groupKey === "other") return;

      category.objects.forEach((obj) => {
        if (!obj?.userData?.isTopLevel) return;

        const h = makeDashedBoxHelper(obj);
        if (!h) return;

        h.visible = obj.visible;
        obj.userData.__boxHelper = h;
        helperRoot.add(h);
      });
    });

    scene.add(helperRoot);
    helperRootRef.current = helperRoot;

    // ====== 3.5) 紫色连线 + 切线段 ======
    const s = 2;
    const linkRoot = new THREE.Group();
    linkRoot.name = "__wire_links__";
    linkRoot.visible = groupVisibility.wire;

    const PURPLE_CATEGORY_KEY = "__purple_links__";

    // 收集 wire 对象（只收“红线体系”）
    const wireObjs = [];
    baseEntityCategoryList.forEach((cat) => {
      const g = initialGroupMap[cat.key] || "other";
      if (g !== "wire") return;
      cat.objects.forEach((o) => wireObjs.push(o));
    });

    // 收集元件（只用 component）
    const compObjs = [];
    baseEntityCategoryList.forEach((cat) => {
      const g = initialGroupMap[cat.key] || "other";
      if (g !== "component") return;
      cat.objects.forEach((o) => compObjs.push(o));
    });

    // 预计算 wires 的线段（世界坐标）
    const wireSegMap = new Map();
    wireObjs.forEach((w) => wireSegMap.set(w.uuid, extractWorldSegments(w)));

    compObjs.forEach((comp) => {
      const compBox = new THREE.Box3().setFromObject(comp);
      if (compBox.isEmpty()) return;

      const center = new THREE.Vector3();
      compBox.getCenter(center);

      const hits = new Map();

      wireObjs.forEach((w) => {
        const segs = wireSegMap.get(w.uuid) || [];
        for (let i = 0; i < segs.length; i++) {
          const [a, b] = segs[i];
          const hit = segmentIntersectBox(a, b, compBox, s);
          if (!hit) continue;

          const c = classifyContact(hit, compBox, s);
          if (c.kind === "unknown") continue;

          // === 切线段：生成两段，加入 wire 的统计集合 ===
          const wireCategoryKey = uuidToCategoryKey.get(w.uuid);
          if (wireCategoryKey && entityStats[wireCategoryKey]) {
            const EPS = 1e-6;

            const d1 = a.distanceTo(hit);
            const d2 = b.distanceTo(hit);

            if (d1 > EPS) {
              const seg1 = makeGeneratedWireSegment(a, hit, w);
              root.add(seg1);
              entityStats[wireCategoryKey].objects.push(seg1);
            }
            if (d2 > EPS) {
              const seg2 = makeGeneratedWireSegment(hit, b, w);
              root.add(seg2);
              entityStats[wireCategoryKey].objects.push(seg2);
            }

            entityStats[wireCategoryKey].count = entityStats[wireCategoryKey].objects.length;
          }

          hits.set(w.uuid, { point: hit, key: c.key });
          break;
        }
      });

      if (hits.size === 1) {
        const only = hits.values().next().value;
        const link = makePurpleLink(center, only.point);

        // ✅ 关键：记录紫线归属元件（用于“紫线算作元件长度”与括号显示）
        link.userData = { ...(link.userData || {}), __purpleOwnerUuid: comp.uuid };

        linkRoot.add(link);
        return;
      }

      if (hits.size >= 2) {
        const hitArr = Array.from(hits.entries());
        for (let i = 0; i < hitArr.length; i++) {
          for (let j = i + 1; j < hitArr.length; j++) {
            const [w1, h1] = hitArr[i];
            const [w2, h2] = hitArr[j];
            if (w1 === w2) continue;
            if (h1.key === h2.key) continue;

            const link = makePurpleLink(h1.point, h2.point);

            // ✅ 关键：记录紫线归属元件
            link.userData = { ...(link.userData || {}), __purpleOwnerUuid: comp.uuid };

            linkRoot.add(link);
          }
        }
      }
    });

    if (linkRoot.children.length > 0) {
      if (!entityStats[PURPLE_CATEGORY_KEY]) {
        entityStats[PURPLE_CATEGORY_KEY] = {
          key: PURPLE_CATEGORY_KEY,
          name: "补充连线",
          type: "PURPLE_LINK",
          blockName: "N/A",
          layer: "N/A",
          color: LINK_CLOR,
          objects: [],
          count: 0
        };
      }

      linkRoot.traverse((o) => {
        if (o.isLine || o.isLineSegments) {
          o.userData = {
            ...(o.userData || {}), // ✅ 保留 __purpleOwnerUuid
            isTopLevel: true,
            type: "LINE",
            baseColor: LINK_CLOR,
            __purpleLink: true
          };
          entityStats[PURPLE_CATEGORY_KEY].objects.push(o);
        }
      });

      entityStats[PURPLE_CATEGORY_KEY].count = entityStats[PURPLE_CATEGORY_KEY].objects.length;

      // ✅ 为了可见性，依旧归为 wire（但后续路径计算会排除 __purpleLink）
      initialGroupMap[PURPLE_CATEGORY_KEY] = "wire";

      scene.add(linkRoot);
      wireLinkRootRef.current = linkRoot;
    } else {
      wireLinkRootRef.current = null;
    }

    // ====== 4) 用最新 entityStats 生成列表 & 更新分组 map ======
    const finalEntityCategoryList = Object.values(entityStats).sort((a, b) => b.count - a.count);
    setEntityCategoryList(finalEntityCategoryList);
    setCategoryGroupMap(initialGroupMap);

    // ====== 5) 初始应用显隐 ======
    applyVisibilityByGroups(finalEntityCategoryList, initialGroupMap, groupVisibility);

    // ====== ✅ 5.5) 生成每个节点的 4位短ID，并在图中打标 ======
    const idLabelRoot = new THREE.Group();
    idLabelRoot.name = "__id_labels__";
    scene.add(idLabelRoot);
    idLabelRootRef.current = idLabelRoot;

    const { get: getShortId } = makeUuidToShortId();

    // 收集我们关心的节点：panel / component / wire(红线) / purple(紫线单独)
    const panelNodes = [];
    const compNodes2 = [];
    const wireNodes2 = [];
    const purpleNodes = []; // ✅ 紫色补充连线：只用于括号展示与“算入元件长度”，不参与路径节点

    finalEntityCategoryList.forEach((cat) => {
      const g = initialGroupMap[cat.key] || "other";
      if (g === "panel") cat.objects.forEach((o) => panelNodes.push(o));
      if (g === "component") cat.objects.forEach((o) => compNodes2.push(o));
      if (g === "wire") {
        cat.objects.forEach((o) => {
          if (o?.userData?.__purpleLink) purpleNodes.push(o);
          else wireNodes2.push(o);
        });
      }
    });

    const isGoodNode = (o) => o?.userData?.isTopLevel;

    const addIdLabelForObj = (obj) => {
      if (!obj || !isGoodNode(obj)) return;
      const id = getShortId(obj.uuid);
      obj.userData.__shortId = id;

      // label 放在对象 bbox 中心
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;
      const center = new THREE.Vector3();
      box.getCenter(center);

      const sprite = makeTextSprite(id, { fontSize: 72, padding: 14, scale: 0.9 });
      sprite.position.copy(center);

      // 与 obj 绑定，显隐跟随
      sprite.visible = obj.visible;
      obj.userData.__idLabel = sprite;

      idLabelRoot.add(sprite);
    };

    panelNodes.forEach(addIdLabelForObj);
    compNodes2.forEach(addIdLabelForObj);
    wireNodes2.forEach(addIdLabelForObj);
    purpleNodes.forEach(addIdLabelForObj); // ✅ 紫线也要有短ID（显示在括号里）

    // ====== ✅ 6) 计算“从电箱(root)开始的所有路径”并统计长度（wire-wire 端点+相交） ======
    // 关键修正：
    // 1) 紫色补充连线（__purpleLink）不参与路径计算（不作为 wire 节点/不建边/不 DFS）
    // 2) 统计总长时：紫色补充连线长度算作其归属元件(component)长度
    // 3) 展示：componentId(purpleId1,...) 例如 00jq(002m)
    (() => {
      const panels = panelNodes.filter(isGoodNode);
      const comps = compNodes2.filter(isGoodNode);

      // ✅ wires 只保留“真实红线体系”（已在 5.5 分离，但这里再保险过滤一次）
      const wires = wireNodes2.filter(isGoodNode).filter((w) => !w.userData?.__purpleLink);

      // --- node maps ---
      const nodeType = new Map(); // uuid -> 'panel'|'component'|'wire'
      const nodeId = new Map(); // uuid -> shortId

      panels.forEach((o) => {
        nodeType.set(o.uuid, "panel");
        nodeId.set(o.uuid, o.userData.__shortId || getShortId(o.uuid));
      });
      comps.forEach((o) => {
        nodeType.set(o.uuid, "component");
        nodeId.set(o.uuid, o.userData.__shortId || getShortId(o.uuid));
      });
      wires.forEach((o) => {
        nodeType.set(o.uuid, "wire");
        nodeId.set(o.uuid, o.userData.__shortId || getShortId(o.uuid));
      });

      const tol = 120;

      // --- component 紫线归并：ids + len ---
      const compPurpleIds = new Map(); // compUuid -> string[]
      const compPurpleLen = new Map(); // compUuid -> number

      const addCompPurple = (compUuid, purpleObj) => {
        if (!compUuid || !purpleObj) return;
        const pid = purpleObj.userData?.__shortId || getShortId(purpleObj.uuid);

        if (!compPurpleIds.has(compUuid)) compPurpleIds.set(compUuid, []);
        compPurpleIds.get(compUuid).push(pid);

        const len = calcWireLength(purpleObj) || 0;
        compPurpleLen.set(compUuid, (compPurpleLen.get(compUuid) || 0) + len);
      };

      purpleNodes.forEach((pl) => {
        if (!pl?.userData?.__purpleLink) return;
        addCompPurple(pl.userData.__purpleOwnerUuid, pl);
      });

      // --- 预计算：box（优先用 helper） ---
      const nodeBox = new Map(); // uuid -> THREE.Box3
      const getBoxFromObjOrHelper = (obj) => {
        const box = new THREE.Box3();
        const target = obj?.userData?.__boxHelper || obj;
        box.setFromObject(target);
        return box;
      };

      panels.forEach((p) => nodeBox.set(p.uuid, getBoxFromObjOrHelper(p)));
      comps.forEach((c) => nodeBox.set(c.uuid, getBoxFromObjOrHelper(c)));

      // --- 预计算：wire segments / wire length / endpoints / wire-wire intersect index ---
      const wireSegCache = new Map(); // wireUuid -> [ [a,b], ... ] in world
      const wireLen = new Map(); // wireUuid -> number
      wires.forEach((w) => {
        const segs = extractWorldSegments(w) || [];
        wireSegCache.set(w.uuid, segs);

        let sum = 0;
        for (const [a, b] of segs) sum += a.distanceTo(b);
        wireLen.set(w.uuid, sum);
      });

      // wire-wire：端点 bucket
      const endpointBucket = new Map(); // key -> Set<wireUuid>
      const addEndpoint = (wireUuid, v) => {
        const k = pointKey(v, tol);
        if (!endpointBucket.has(k)) endpointBucket.set(k, new Set());
        endpointBucket.get(k).add(wireUuid);
      };
      wires.forEach((w) => {
        const segs = wireSegCache.get(w.uuid) || [];
        for (const [a, b] of segs) {
          addEndpoint(w.uuid, a);
          addEndpoint(w.uuid, b);
        }
      });

      // wire-wire：线段相交网格索引（只对真实 wires 建索引，紫线不参与）
      const cellSize = Math.max(10 * tol, 10);
      const grid = new Map(); // cellKey -> entry[]
      // entry: { wireUuid, a2, b2 }
      wires.forEach((w) => {
        const segs = wireSegCache.get(w.uuid) || [];
        for (const [a3, b3] of segs) {
          const a2 = { x: a3.x, y: a3.y };
          const b2 = { x: b3.x, y: b3.y };
          const bb = segBBox2D(a2, b2);

          const minIx = Math.floor((bb.minX - tol) / cellSize);
          const maxIx = Math.floor((bb.maxX + tol) / cellSize);
          const minIy = Math.floor((bb.minY - tol) / cellSize);
          const maxIy = Math.floor((bb.maxY + tol) / cellSize);

          const entry = { wireUuid: w.uuid, a2, b2 };

          for (let ix = minIx; ix <= maxIx; ix++) {
            for (let iy = minIy; iy <= maxIy; iy++) {
              const k = cellKey(ix, iy);
              if (!grid.has(k)) grid.set(k, []);
              grid.get(k).push(entry);
            }
          }
        }
      });

      const makePairKey = (w1, w2) => {
        const a = w1 < w2 ? w1 : w2;
        const b = w1 < w2 ? w2 : w1;
        return `${a}|${b}`;
      };

      // ========= 动态邻接查询（递归时使用） =========

      // 1) element(panel/component) -> wires：判断 wire seg 是否命中 element 的 box(helper)
      const getWiresTouchElement = (elemUuid) => {
        const box = nodeBox.get(elemUuid);
        if (!box || box.isEmpty()) return [];
        const res = [];
        for (const w of wires) {
          const segs = wireSegCache.get(w.uuid) || [];
          for (let i = 0; i < segs.length; i++) {
            const [a, b] = segs[i];
            if (segmentIntersectBox(a, b, box, tol)) {
              res.push(w.uuid);
              break;
            }
          }
        }
        return res;
      };

      // 2) wire -> elements(panel/component)：找所有命中该 wire 的 box(helper)
      const getElementsTouchWire = (wireUuid) => {
        const segs = wireSegCache.get(wireUuid) || [];
        if (segs.length === 0) return [];

        const hitElem = (elemUuid) => {
          const box = nodeBox.get(elemUuid);
          if (!box || box.isEmpty()) return false;
          for (const [a, b] of segs) {
            if (segmentIntersectBox(a, b, box, tol)) return true;
          }
          return false;
        };

        const res = [];
        for (const p of panels) if (hitElem(p.uuid)) res.push(p.uuid);
        for (const c of comps) if (hitElem(c.uuid)) res.push(c.uuid);
        return res;
      };

      // 3) wire -> wires：端点近似共点 + 线段相交（紫线不参与）
      const getWiresTouchWire = (wireUuid) => {
        const out = new Set();

        // 3.1 端点共点
        const segs = wireSegCache.get(wireUuid) || [];
        for (const [a, b] of segs) {
          const k1 = pointKey(a, tol);
          const k2 = pointKey(b, tol);
          const s1 = endpointBucket.get(k1);
          const s2 = endpointBucket.get(k2);
          if (s1) s1.forEach((w) => w !== wireUuid && out.add(w));
          if (s2) s2.forEach((w) => w !== wireUuid && out.add(w));
        }

        // 3.2 线段相交（用网格桶减少比较）
        const compared = new Set(); // pairKey 去重
        for (const [a3, b3] of segs) {
          const a2 = { x: a3.x, y: a3.y };
          const b2 = { x: b3.x, y: b3.y };
          const bb = segBBox2D(a2, b2);

          const minIx = Math.floor((bb.minX - tol) / cellSize);
          const maxIx = Math.floor((bb.maxX + tol) / cellSize);
          const minIy = Math.floor((bb.minY - tol) / cellSize);
          const maxIy = Math.floor((bb.maxY + tol) / cellSize);

          for (let ix = minIx; ix <= maxIx; ix++) {
            for (let iy = minIy; iy <= maxIy; iy++) {
              const k = cellKey(ix, iy);
              const bucket = grid.get(k);
              if (!bucket || bucket.length === 0) continue;

              for (const e of bucket) {
                if (e.wireUuid === wireUuid) continue;
                const pk = makePairKey(wireUuid, e.wireUuid);
                if (compared.has(pk)) continue;

                if (segsIntersect2D(a2, b2, e.a2, e.b2, tol)) {
                  out.add(e.wireUuid);
                  compared.add(pk);
                }
              }
            }
          }
        }

        return Array.from(out);
      };

      // ========= 结果去重/合并 =========
      // 1) 完整路径去重（注意：component 显示会带括号，所以 seqKey 用“带括号的显示串”）
      const pathSeqSeen = new Set();

      // 2) 同 root + 同 component 只保留最短（pairKey 用“纯 componentId”，不带括号）
      const bestByPair = new Map();

      const formatNodeIdForDisplay = (uuid) => {
        const base = nodeId.get(uuid) || getShortId(uuid);
        if (nodeType.get(uuid) !== "component") return base;

        const extra = compPurpleIds.get(uuid);
        if (!extra || extra.length === 0) return base;

        const uniq = Array.from(new Set(extra)).sort((a, b) => a.localeCompare(b));
        return `${base}(${uniq.join(",")})`;
      };

      const pushResult = (pathUuids) => {
        const lastUuid = pathUuids[pathUuids.length - 1];
        if (nodeType.get(lastUuid) !== "component") return;

        const ids = pathUuids.map((uuid) => formatNodeIdForDisplay(uuid));
        const seqKey = ids.join("->");
        if (pathSeqSeen.has(seqKey)) return;
        pathSeqSeen.add(seqKey);

        // ✅ 长度：只算“真实 wires” + “component 的紫线长度（算作元件长度）”
        let len = 0;
        for (const uuid of pathUuids) {
          const t = nodeType.get(uuid);
          if (t === "wire") len += wireLen.get(uuid) || 0;
          if (t === "component") len += compPurpleLen.get(uuid) || 0;
        }

        const rootUuid = pathUuids[0];
        const rootShort = nodeId.get(rootUuid) || getShortId(rootUuid);
        const compShort = nodeId.get(lastUuid) || getShortId(lastUuid); // ✅ 不带括号
        const pairKey = `${rootShort}|${compShort}`;

        const prev = bestByPair.get(pairKey);
        if (!prev || len < prev.length) {
          bestByPair.set(pairKey, { ids, length: len });
        }
      };

      // ========= 递归遍历 =========
      // 规则：
      // - element -> wires：box(helper) 相交
      // - wire -> element：box(helper) 相交（“另一侧”）
      // - wire -> wire：端点 + 相交
      // - 紫线不参与任何邻接/递归
      // - 结束：当某个 element 没有可继续的 wire（排除来路 + 已访问）时，如果终点是 component，落库
      const walk = (curUuid, prevUuid, visited, path) => {
        const t = nodeType.get(curUuid);

        if (t === "panel" || t === "component") {
          const wiresTouch = getWiresTouchElement(curUuid).filter((w) => !visited.has(w));

          if (wiresTouch.length === 0) {
            pushResult(path);
            return;
          }

          for (const wUuid of wiresTouch) {
            if (prevUuid && nodeType.get(prevUuid) === "wire" && wUuid === prevUuid) continue;

            visited.add(wUuid);
            path.push(wUuid);
            walk(wUuid, curUuid, visited, path);
            path.pop();
            visited.delete(wUuid);
          }
          return;
        }

        if (t === "wire") {
          const elems = getElementsTouchWire(curUuid).filter((e) => !visited.has(e));
          const ww = getWiresTouchWire(curUuid).filter((w) => !visited.has(w));

          if (elems.length === 0 && ww.length === 0) return;

          for (const eUuid of elems) {
            if (prevUuid && nodeType.get(prevUuid) !== "wire" && eUuid === prevUuid) continue;

            visited.add(eUuid);
            path.push(eUuid);
            walk(eUuid, curUuid, visited, path);
            path.pop();
            visited.delete(eUuid);
          }

          for (const w2 of ww) {
            if (prevUuid && nodeType.get(prevUuid) === "wire" && w2 === prevUuid) continue;

            visited.add(w2);
            path.push(w2);
            walk(w2, curUuid, visited, path);
            path.pop();
            visited.delete(w2);
          }
          return;
        }
      };

      panels.forEach((p) => {
        const visited = new Set([p.uuid]);
        walk(p.uuid, null, visited, [p.uuid]);
      });

      const results = Array.from(bestByPair.values());

      results.sort((a, b) => {
        const a0 = a.ids[0],
          b0 = b.ids[0];
        if (a0 !== b0) return a0.localeCompare(b0);

        const a1 = a.ids[a.ids.length - 1],
          b1 = b.ids[b.ids.length - 1];
        if (a1 !== b1) return a1.localeCompare(b1);

        return a.length - b.length;
      });

      setRouterPaths(results);
    })();

    // ====== 7) 适配相机 ======
    fittedOnceRef.current = false;
    if (!fittedOnceRef.current) {
      fitCameraToBox(root, camera, controls);
      fittedOnceRef.current = true;
    }
  };

  return (
    <>
      <div className={`viewerRoot ${mode === "fill" ? "viewerFill" : "viewerFixed"}`}>
        <div ref={mountRef} className="threeMount" style={mountStyle} />
        {err ? <div className="err">{err}</div> : null}
      </div>

      <div className="detail">
        <div className="menu">
          <span onClick={() => setMenuIndex(0)}>结构</span>
          <span onClick={() => setMenuIndex(1)}>报价</span>
        </div>

        {menuIndex === 0 ? (
          <div className="dxf-detail-panel">
            <div className="detail-header">
              <div className="select-all-wrapper" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`group-btn ${groupVisibility.main ? "on" : "off"}`}
                  onClick={() => toggleGroupVisibility("main")}
                >
                  显示配电箱和元件
                </button>
                <button
                  type="button"
                  className={`group-btn ${groupVisibility.wire ? "on" : "off"}`}
                  onClick={() => toggleGroupVisibility("wire")}
                >
                  显示电线
                </button>
                <button
                  type="button"
                  className={`group-btn ${groupVisibility.other ? "on" : "off"}`}
                  onClick={() => toggleGroupVisibility("other")}
                >
                  显示其他
                </button>
              </div>
            </div>

            <div className="entity-category-list">
              <div className="category-item">
                <div className="category-radios">
                  <span>电箱</span>
                  <span>元件</span>
                  <span>电线</span>
                  <span>其他</span>
                </div>
                <div className="category-label">名称</div>
              </div>

              {entityCategoryList.length === 0 ? (
                <div className="empty-tip">未找到可统计的DXF元素类别</div>
              ) : (
                entityCategoryList
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((category) => {
                    const colorStr = "#" + category.color.toString(16).padStart(6, "0");
                    const currentGroup = categoryGroupMap[category.key] || "other";

                    return (
                      <div key={category.key} className="category-item">
                        <div className="category-radios">
                          {GROUPS.map((g) => {
                            const radioId = `${category.key}__${g.key}`;
                            return (
                              <span key={g.key}>
                                <input
                                  type="radio"
                                  id={radioId}
                                  name={`group_${category.key}`}
                                  checked={currentGroup === g.key}
                                  onChange={() => handleCategoryGroupChange(category.key, g.key)}
                                />
                              </span>
                            );
                          })}
                        </div>

                        <div className="category-label">
                          <div className="category-color" style={{ background: colorStr }}></div>
                          <div className="category-info">
                            <i>{category.name}</i>
                            <span>{category.count}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        ) : (
          <div className="dxf-router-panel">
            {routerPaths.length === 0 ? (
              <div className="empty-tip">未计算到从电箱出发的路径（请确认分组：电箱/元件/电线）</div>
            ) : (
              (() => {
                // 按配电箱ID分组：rootId = p.ids[0]
                const groups = routerPaths.reduce((acc, p) => {
                  const rootId = p?.ids?.[0] || "????";
                  if (!acc[rootId]) acc[rootId] = [];
                  acc[rootId].push(p);
                  return acc;
                }, {});

                // 排序：电箱ID升序；组内按长度升序
                const rootIds = Object.keys(groups).sort((a, b) => a.localeCompare(b));
                rootIds.forEach((rid) => groups[rid].sort((a, b) => a.length - b.length));

                return (
                  <div className="router-groups">
                    {rootIds.map((rid) => {
                      const list = groups[rid];
                      const totalLen = list.reduce((s, p) => s + (Number(p.length) || 0), 0);

                      return (
                        <div key={rid} className="router-group">
                          <div className="router-group-title">
                            <span className="router-title">
                              配电箱 {rid} 【{list.length}条】
                            </span>
                            <span className="router-group-sum">总长度：{totalLen.toFixed(2)}</span>
                          </div>

                          <div className="router-list">
                            {list.map((p, idx) => {
                              const text = p.ids.join(" -> ");
                              return (
                                <div key={`${rid}_${idx}`} className="router-item">
                                  {text} <i>{p.length.toFixed(2)}</i>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </div>
        )}
      </div>
    </>
  );
}
