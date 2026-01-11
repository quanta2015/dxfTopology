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
  makePurpleLink
} from "./helper.js";

// ====== 分组定义：4个集合（用于 radio），3个按钮控制显示 ======
const GROUPS = [
  { key: "panel", label: "配电箱" },
  { key: "component", label: "元件" },
  { key: "wire", label: "电线" },
  { key: "other", label: "其他" }
];

const LINK_CLOR = 0x800080; // 紫色
// const LINK_CLOR = 0xd453fc;

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

    // 新增：用于把“生成线段”塞回原 wire 的类别里
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

    // 注意：此时还没把紫色连线、切线段都注册完，所以先别 setEntityCategoryList
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

    // 紫色连线类别（让右侧 detail 出现）
    const PURPLE_CATEGORY_KEY = "__purple_links__";

    // 收集 wire 对象
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
    wireObjs.forEach((w) => {
      wireSegMap.set(w.uuid, extractWorldSegments(w));
    });

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
            linkRoot.add(link);
          }
        }
      }
    });

    // === 把紫色连线也塞进 entityStats（否则右侧 detail 不会出现） ===
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

      // makePurpleLink 可能返回 Group/Line/LineSegments，统一 traverse 收集
      linkRoot.traverse((o) => {
        if (o.isLine || o.isLineSegments) {
          o.userData = {
            ...(o.userData || {}),
            isTopLevel: true,
            type: "LINE",
            baseColor: LINK_CLOR,
            __purpleLink: true
          };
          entityStats[PURPLE_CATEGORY_KEY].objects.push(o);
        }
      });

      entityStats[PURPLE_CATEGORY_KEY].count = entityStats[PURPLE_CATEGORY_KEY].objects.length;

      // 紫色连线也归入 wire 分组，让“显示电线”按钮控制它
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

    // ====== 5) 初始应用显隐（必须用 finalEntityCategoryList） ======
    applyVisibilityByGroups(finalEntityCategoryList, initialGroupMap, groupVisibility);

    // ====== 6) 适配相机 ======
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
          <div className="dxf-router-panel"></div>
        )}
      </div>
    </>
  );
}
