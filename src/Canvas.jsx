// import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
// import * as THREE from "three";
// import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
// import DxfParser from "dxf-parser";
// import "./Canvas.less";
// import {
//   drawEntity,
//   disposeObject,
//   normalizeRootToOriginByLines,
//   fitCameraToBox,
//   isRedColorByHex,
//   getEntityDisplayName,
//   getCategoryUniqueKey,
//   isContainChinese,
//   makeDashedBoxHelper
// } from "./helper.js";

// // ====== 分组定义：4个集合（用于 radio），3个按钮控制显示 ======
// const GROUPS = [
//   { key: "panel", label: "配电箱" },
//   { key: "component", label: "元件" },
//   { key: "wire", label: "电线" },
//   { key: "other", label: "其他" }
// ];

// export default function CanvasViewer({ mode = "fill", width = 1600, height = 900 }) {
//   const mountRef = useRef(null);
//   const helperRootRef = useRef(null);

//   const rendererRef = useRef(null);
//   const sceneRef = useRef(null);
//   const cameraRef = useRef(null);
//   const controlsRef = useRef(null);

//   const dxfRootRef = useRef(null);
//   const animRef = useRef(0);
//   const roRef = useRef(null);

//   const fittedOnceRef = useRef(false);

//   const [err, setErr] = useState("");
//   const [dxfText, setDxfText] = useState("");
//   const [entityCategoryList, setEntityCategoryList] = useState([]);
//   const [categoryGroupMap, setCategoryGroupMap] = useState(() => ({}));
//   const [groupVisibility, setGroupVisibility] = useState(() => ({
//     main: true, // panel + component
//     wire: true,
//     other: false
//   }));

//   const mountStyle = useMemo(() => {
//     if (mode === "fixed") return { width: `${width}px`, height: `${height}px` };
//     return { width: "100%", height: "100%" };
//   }, [mode, width, height]);

//   // ====== 将 4个集合映射到 3个按钮开关 ======
//   const isGroupVisible = useCallback((groupKey, vis) => {
//     if (groupKey === "panel" || groupKey === "component") return vis.main;
//     if (groupKey === "wire") return vis.wire;
//     return vis.other;
//   }, []);

//   // ====== 根据“类别所属集合 + 集合开关”批量更新可见性 ======
//   const applyVisibilityByGroups = useCallback(
//     (list, groupMap, vis) => {
//       list.forEach((category) => {
//         const groupKey = groupMap[category.key] || "other";
//         const show = isGroupVisible(groupKey, vis);

//         category.objects.forEach((obj) => {
//           obj.visible = show;

//           // 同步 helper
//           if (obj.userData?.__boxHelper) {
//             obj.userData.__boxHelper.visible = show;
//           }
//         });
//       });
//     },
//     [isGroupVisible]
//   );

//   // ====== 类别行 radio 变更：重新归类 + 应用可见性 ======
//   const handleCategoryGroupChange = useCallback(
//     (categoryKey, nextGroupKey) => {
//       setCategoryGroupMap((prev) => {
//         const next = { ...prev, [categoryKey]: nextGroupKey };
//         applyVisibilityByGroups(entityCategoryList, next, groupVisibility);
//         return next;
//       });
//     },
//     [applyVisibilityByGroups, entityCategoryList, groupVisibility]
//   );

//   // ====== 3 个按钮：切换集合显隐 ======
//   const toggleGroupVisibility = useCallback(
//     (which) => {
//       setGroupVisibility((prev) => {
//         const next = { ...prev, [which]: !prev[which] };
//         applyVisibilityByGroups(entityCategoryList, categoryGroupMap, next);
//         return next;
//       });
//     },
//     [applyVisibilityByGroups, entityCategoryList, categoryGroupMap]
//   );

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

//   // ====== three init / dispose ======
//   useEffect(() => {
//     const mount = mountRef.current;
//     if (!mount) return;

//     const scene = new THREE.Scene();
//     scene.background = new THREE.Color(0x212121);
//     sceneRef.current = scene;

//     const camera = new THREE.OrthographicCamera(-500, 500, 500, -500, 1, 2_000_000);
//     camera.position.set(0, 0, 1000);
//     cameraRef.current = camera;

//     const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
//     renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
//     rendererRef.current = renderer;
//     mount.appendChild(renderer.domElement);

//     const controls = new OrbitControls(camera, renderer.domElement);
//     controls.enableRotate = false;
//     controls.mouseButtons = {
//       LEFT: THREE.MOUSE.PAN,
//       MIDDLE: THREE.MOUSE.DOLLY,
//       RIGHT: THREE.MOUSE.PAN
//     };
//     controls.enableDamping = true;
//     controls.dampingFactor = 0.25;
//     controls.screenSpacePanning = true;
//     controlsRef.current = controls;

//     // cursor
//     renderer.domElement.style.cursor = "default";
//     const onDown = () => (renderer.domElement.style.cursor = "grabbing");
//     const onUp = () => (renderer.domElement.style.cursor = "default");
//     renderer.domElement.addEventListener("pointerdown", onDown);
//     window.addEventListener("pointerup", onUp);

//     const applySize = () => {
//       const rect = mount.getBoundingClientRect();
//       const w = Math.max(1, Math.floor(rect.width));
//       const h = Math.max(1, Math.floor(rect.height));
//       if (!w || !h) return;

//       const aspect = w / h;
//       const viewSize = Math.max(w, h) / 2;
//       camera.left = (-viewSize * aspect) / 2;
//       camera.right = (viewSize * aspect) / 2;
//       camera.top = viewSize / 2;
//       camera.bottom = -viewSize / 2;
//       camera.updateProjectionMatrix();

//       renderer.setSize(w, h, false);
//       renderer.domElement.style.width = `${w}px`;
//       renderer.domElement.style.height = `${h}px`;

//       controls.update();
//     };

//     applySize();

//     if (mode === "fill") {
//       const ro = new ResizeObserver(() => applySize());
//       ro.observe(mount);
//       roRef.current = ro;
//     }

//     const animate = () => {
//       animRef.current = requestAnimationFrame(animate);
//       controls.update();
//       renderer.render(scene, camera);
//     };
//     animate();

//     return () => {
//       cancelAnimationFrame(animRef.current);

//       if (roRef.current) {
//         roRef.current.disconnect();
//         roRef.current = null;
//       }

//       window.removeEventListener("pointerup", onUp);
//       renderer.domElement.removeEventListener("pointerdown", onDown);

//       if (helperRootRef.current) {
//         scene.remove(helperRootRef.current);
//         disposeObject(helperRootRef.current);
//         helperRootRef.current = null;
//       }

//       if (dxfRootRef.current) {
//         scene.remove(dxfRootRef.current);
//         disposeObject(dxfRootRef.current);
//         dxfRootRef.current = null;
//       }

//       fittedOnceRef.current = false;

//       controls.dispose();
//       renderer.dispose();
//       if (renderer.domElement.parentElement) {
//         renderer.domElement.parentElement.removeChild(renderer.domElement);
//       }

//       rendererRef.current = null;
//       sceneRef.current = null;
//       cameraRef.current = null;
//       controlsRef.current = null;
//     };
//   }, [mode]);

//   // ====== render DXF when text changes ======
//   useEffect(() => {
//     if (!dxfText) return;
//     if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;

//     try {
//       renderDxfFromText(dxfText);
//       setErr("");
//     } catch (e) {
//       console.error(e);
//       setErr(`解析失败：${e.message || String(e)}`);
//     }
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [dxfText]);

//   const renderDxfFromText = (text) => {
//     const scene = sceneRef.current;
//     const camera = cameraRef.current;
//     const controls = controlsRef.current;

//     // 清理旧 root
//     if (dxfRootRef.current) {
//       scene.remove(dxfRootRef.current);
//       disposeObject(dxfRootRef.current);
//       dxfRootRef.current = null;
//     }

//     // 清理旧 helpers
//     if (helperRootRef.current) {
//       scene.remove(helperRootRef.current);
//       disposeObject(helperRootRef.current);
//       helperRootRef.current = null;
//     }

//     const parser = new DxfParser();
//     const dxf = parser.parseSync(text);

//     const tables = dxf.tables || {};
//     const blocks = dxf.blocks || {};
//     tables.blocks = blocks;
//     tables.layers = dxf.tables?.layer?.layers ? dxf.tables.layer.layers : {};

//     const root = new THREE.Group();
//     (dxf.entities || []).forEach((ent) => {
//       const obj = drawEntity(ent, tables, true, null);
//       if (obj) root.add(obj);
//     });

//     normalizeRootToOriginByLines(root);
//     scene.add(root);
//     dxfRootRef.current = root;

//     // 确保 matrixWorld 正确（Box3.setFromObject 需要）
//     root.updateWorldMatrix(true, true);

//     // ====== 1) 分类收集 ======
//     const entityStats = {};
//     const dxfBlocks = blocks;

//     root.traverse((obj) => {
//       if (obj.userData && obj.userData.isTopLevel) {
//         const userData = obj.userData;
//         const name = getEntityDisplayName(userData, dxfBlocks);
//         const color = userData.baseColor || 0xffffff;
//         const categoryKey = getCategoryUniqueKey(userData, name, color);

//         if (!entityStats[categoryKey]) {
//           entityStats[categoryKey] = {
//             key: categoryKey,
//             name,
//             type: userData.type,
//             blockName: userData.name || "N/A",
//             layer: userData.layer || "N/A",
//             color,
//             objects: [],
//             count: 0
//           };
//         }

//         entityStats[categoryKey].objects.push(obj);
//         entityStats[categoryKey].count = entityStats[categoryKey].objects.length;
//       }
//     });

//     const newEntityCategoryList = Object.values(entityStats).sort((a, b) => b.count - a.count);
//     setEntityCategoryList(newEntityCategoryList);

//     // ====== 2) 初始化分组映射 ======
//     const initialGroupMap = {};
//     newEntityCategoryList.forEach((category) => {
//       let g = "other";

//       if ((category.type === "LINE" || category.type === "LWPOLYLINE") && isRedColorByHex(category.color)) {
//         g = "wire";
//       } else if (isContainChinese(category.name)) {
//         g = /配电箱/.test(category.name) ? "panel" : "component";
//       } else {
//         g = "other";
//       }

//       initialGroupMap[category.key] = g;
//     });

//     setCategoryGroupMap(initialGroupMap);

//     // ====== 3) 创建辅助框（仅 panel/component；wire/other 不创建） ======
//     const helperRoot = new THREE.Group();
//     helperRoot.name = "__helpers__";

//     // 再次确保 world matrix（某些 drawEntity 内部可能延迟更新）
//     root.updateWorldMatrix(true, true);

//     newEntityCategoryList.forEach((category) => {
//       const groupKey = initialGroupMap[category.key] || "other";
//       if (groupKey === "wire" || groupKey === "other") return;

//       category.objects.forEach((obj) => {
//         if (!obj?.userData?.isTopLevel) return;

//         const h = makeDashedBoxHelper(obj);
//         if (!h) return;

//         // 跟随对象显隐
//         h.visible = obj.visible;

//         obj.userData.__boxHelper = h;
//         helperRoot.add(h);
//       });
//     });

//     scene.add(helperRoot);
//     helperRootRef.current = helperRoot;

//     // ====== 4) 初始应用显隐（会同步 helper.visible） ======
//     applyVisibilityByGroups(newEntityCategoryList, initialGroupMap, groupVisibility);

//     // ====== 5) 适配相机 ======
//     fittedOnceRef.current = false;
//     if (!fittedOnceRef.current) {
//       fitCameraToBox(root, camera, controls);
//       fittedOnceRef.current = true;
//     }
//   };

//   return (
//     <>
//       <div className={`viewerRoot ${mode === "fill" ? "viewerFill" : "viewerFixed"}`}>
//         <div ref={mountRef} className="threeMount" style={mountStyle} />
//         {err ? <div className="err">{err}</div> : null}
//       </div>

//       <div className="detail">
//         <div className="dxf-detail-panel">
//           <div className="detail-header">
//             <div className="select-all-wrapper" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
//               <button
//                 type="button"
//                 className={`group-btn ${groupVisibility.main ? "on" : "off"}`}
//                 onClick={() => toggleGroupVisibility("main")}
//               >
//                 显示配电箱和元件
//               </button>
//               <button
//                 type="button"
//                 className={`group-btn ${groupVisibility.wire ? "on" : "off"}`}
//                 onClick={() => toggleGroupVisibility("wire")}
//               >
//                 显示电线
//               </button>
//               <button
//                 type="button"
//                 className={`group-btn ${groupVisibility.other ? "on" : "off"}`}
//                 onClick={() => toggleGroupVisibility("other")}
//               >
//                 显示其他
//               </button>
//             </div>
//           </div>

//           <div className="entity-category-list">
//             <div className="category-item">
//               <div className="category-radios">
//                 <span>电箱</span>
//                 <span>元件</span>
//                 <span>电线</span>
//                 <span>其他</span>
//               </div>
//               <div className="category-label">名称</div>
//             </div>

//             {entityCategoryList.length === 0 ? (
//               <div className="empty-tip">未找到可统计的DXF元素类别</div>
//             ) : (
//               entityCategoryList
//                 .sort((a, b) => a.name.localeCompare(b.name))
//                 .map((category) => {
//                   const colorStr = "#" + category.color.toString(16).padStart(6, "0");
//                   const currentGroup = categoryGroupMap[category.key] || "other";

//                   return (
//                     <div key={category.key} className="category-item">
//                       <div className="category-radios">
//                         {GROUPS.map((g) => {
//                           const radioId = `${category.key}__${g.key}`;
//                           return (
//                             <span key={g.key}>
//                               <input
//                                 type="radio"
//                                 id={radioId}
//                                 name={`group_${category.key}`}
//                                 checked={currentGroup === g.key}
//                                 onChange={() => handleCategoryGroupChange(category.key, g.key)}
//                               />
//                             </span>
//                           );
//                         })}
//                       </div>

//                       <div className="category-label">
//                         <div className="category-color" style={{ background: colorStr }}></div>
//                         <div className="category-info">
//                           <i>{category.name}</i>
//                           <span>{category.count}</span>
//                         </div>
//                       </div>
//                     </div>
//                   );
//                 })
//             )}
//           </div>
//         </div>
//       </div>
//     </>
//   );
// }

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
  makeDashedBoxHelper // 这里假设你 helper.js 里已改成“黄金色实线辅助框”
} from "./helper.js";

// ====== 分组定义：4个集合（用于 radio），3个按钮控制显示 ======
const GROUPS = [
  { key: "panel", label: "配电箱" },
  { key: "component", label: "元件" },
  { key: "wire", label: "电线" },
  { key: "other", label: "其他" }
];

// ====== 工具：从 wire 对象里提取世界坐标线段 ======
const extractWorldSegments = (obj) => {
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

// ====== 工具：线段与 Box 相交（允许误差 s） ======
const segmentIntersectBox = (a, b, box, s) => {
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

// ====== 工具：判定交点落在 box 的哪条“边/面”（用于“同一条边上”过滤） ======
const classifyContact = (p, box, s) => {
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

// ====== 工具：创建紫色连线 ======
const makePurpleLink = (p1, p2) => {
  const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const mat = new THREE.LineBasicMaterial({ color: 0x8000ff });
  const line = new THREE.Line(geo, mat);

  line.renderOrder = 999998;
  line.material.depthTest = false;
  line.material.depthWrite = false;

  line.userData.isWireLink = true;
  return line;
};

export default function CanvasViewer({ mode = "fill", width = 1600, height = 900 }) {
  const mountRef = useRef(null);
  const helperRootRef = useRef(null);
  const wireLinkRootRef = useRef(null);

  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);

  const dxfRootRef = useRef(null);
  const animRef = useRef(0);
  const roRef = useRef(null);

  const fittedOnceRef = useRef(false);

  const [err, setErr] = useState("");
  const [dxfText, setDxfText] = useState("");
  const [entityCategoryList, setEntityCategoryList] = useState([]);
  const [categoryGroupMap, setCategoryGroupMap] = useState(() => ({}));
  const [groupVisibility, setGroupVisibility] = useState(() => ({
    main: true, // panel + component
    wire: true,
    other: false
  }));

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
          if (obj.userData?.__boxHelper) {
            obj.userData.__boxHelper.visible = show;
          }
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

    // cursor
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
      }
    });

    const newEntityCategoryList = Object.values(entityStats).sort((a, b) => b.count - a.count);
    setEntityCategoryList(newEntityCategoryList);

    // ====== 2) 初始化分组映射 ======
    const initialGroupMap = {};
    newEntityCategoryList.forEach((category) => {
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

    setCategoryGroupMap(initialGroupMap);

    // ====== 3) 创建辅助框（仅 panel/component；wire/other 不创建） ======
    const helperRoot = new THREE.Group();
    helperRoot.name = "__helpers__";

    root.updateWorldMatrix(true, true);

    newEntityCategoryList.forEach((category) => {
      const groupKey = initialGroupMap[category.key] || "other";
      if (groupKey === "wire" || groupKey === "other") return;

      category.objects.forEach((obj) => {
        if (!obj?.userData?.isTopLevel) return;

        const h = makeDashedBoxHelper(obj); // 黄金色实线辅助框
        if (!h) return;

        h.visible = obj.visible;
        obj.userData.__boxHelper = h;
        helperRoot.add(h);
      });
    });

    scene.add(helperRoot);
    helperRootRef.current = helperRoot;

    // ====== 3.5) 若两条电线与元件Box相交(允许误差s)，且不在同一条边上 => 画紫色连线 ======
    const s = 2; // 误差容忍，按你的 DXF 单位调（1~10常见）
    const linkRoot = new THREE.Group();
    linkRoot.name = "__wire_links__";
    linkRoot.visible = groupVisibility.wire;

    // 收集 wire 对象
    const wireObjs = [];
    newEntityCategoryList.forEach((cat) => {
      const g = initialGroupMap[cat.key] || "other";
      if (g !== "wire") return;
      cat.objects.forEach((o) => wireObjs.push(o));
    });

    // 收集元件（panel/component）
    const compObjs = [];
    newEntityCategoryList.forEach((cat) => {
      const g = initialGroupMap[cat.key] || "other";
      if (g !== "component") return;
      cat.objects.forEach((o) => compObjs.push(o));
    });

    // 预计算 wires 的线段
    const wireSegMap = new Map(); // uuid -> segments
    wireObjs.forEach((w) => {
      wireSegMap.set(w.uuid, extractWorldSegments(w));
    });

    // 对每个元件找 wire 相交
    compObjs.forEach((comp) => {
      const compBox = new THREE.Box3().setFromObject(comp);
      if (compBox.isEmpty()) return;

      // wireUuid -> { point, key }
      const hits = new Map();

      wireObjs.forEach((w) => {
        const segs = wireSegMap.get(w.uuid) || [];
        for (let i = 0; i < segs.length; i++) {
          const [a, b] = segs[i];
          const hit = segmentIntersectBox(a, b, compBox, s);
          if (!hit) continue;

          const c = classifyContact(hit, compBox, s);
          if (c.kind === "unknown") continue;

          // 记录该 wire 的第一个有效交点
          hits.set(w.uuid, { point: hit, key: c.key });
          break;
        }
      });

      if (hits.size < 2) return;

      const hitArr = Array.from(hits.entries()); // [wireUuid, {point,key}]
      for (let i = 0; i < hitArr.length; i++) {
        for (let j = i + 1; j < hitArr.length; j++) {
          const [w1, h1] = hitArr[i];
          const [w2, h2] = hitArr[j];
          if (w1 === w2) continue;

          // “不在同一条边上” => key 不同（同面/同边/同角都会是同key）
          if (h1.key === h2.key) continue;

          const link = makePurpleLink(h1.point, h2.point);
          linkRoot.add(link);
        }
      }
    });

    if (linkRoot.children.length > 0) {
      scene.add(linkRoot);
      wireLinkRootRef.current = linkRoot;
    } else {
      // 没有连线也留空引用
      wireLinkRootRef.current = null;
    }

    // ====== 4) 初始应用显隐（会同步 helper.visible） ======
    applyVisibilityByGroups(newEntityCategoryList, initialGroupMap, groupVisibility);

    // ====== 5) 适配相机 ======
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
      </div>
    </>
  );
}
