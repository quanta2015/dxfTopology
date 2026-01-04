import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import DxfParser from "dxf-parser";
import "./Canvas.css";
import { drawEntity, disposeObject, normalizeRootToOriginByLines, fitCameraToBox, isRedColorByHex } from "./helper.js";

// ====== 你提供的 getEntityDisplayName 函数 ======
function getEntityDisplayName(userData, blocks = {}) {
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
const getCategoryUniqueKey = (userData, name, color) => {
  const colorHex = "#" + color.toString(16).padStart(6, "0");
  // 对LWPOLYLINE，Key拼接颜色值；其他类型沿用原有逻辑
  if (userData.type === "LWPOLYLINE" || userData.type === "LINE") {
    return `${userData.type}:${name}:${colorHex}`;
  }
  return `${userData.type}:${name}`;
};

/** 辅助函数：生成LWPOLYLINE带颜色的显示名称 */
const getLwpolylineDisplayName = (name, color) => {
  const colorHex = "#" + color.toString(16).padStart(6, "0");
  return `${name}（${colorHex}）`;
};

/** 新增：判断字符串是否包含中文（核心：中文正则 \u4e00-\u9fa5） */
const isContainChinese = (str) => {
  if (!str) return false;
  const chineseReg = /[\u4e00-\u9fa5]/;
  return chineseReg.test(str);

  // return true;
};

export default function CanvasViewer({ mode = "fill", width = 1600, height = 900 }) {
  const mountRef = useRef(null);

  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);

  const dxfRootRef = useRef(null);
  const animRef = useRef(0);
  const roRef = useRef(null);

  // ✅ 原有逻辑：只在加载 DXF 时 fit 一次
  const fittedOnceRef = useRef(false);

  const [err, setErr] = useState("");
  const [dxfText, setDxfText] = useState("");
  // ✅ 类别列表状态
  const [entityCategoryList, setEntityCategoryList] = useState([]);
  // ✅ 选中类别Key状态
  const [checkedCategoryKeys, setCheckedCategoryKeys] = useState(new Set());

  const mountStyle = useMemo(() => {
    if (mode === "fixed") return { width: `${width}px`, height: `${height}px` };
    return { width: "100%", height: "100%" };
  }, [mode, width, height]);

  // ====== 类别复选框变更处理（批量控制元素） ======
  const handleCategoryCheck = (categoryKey, isChecked) => {
    setCheckedCategoryKeys((prevSet) => {
      const newSet = new Set(prevSet);
      // 更新类别选中状态
      if (isChecked) {
        newSet.add(categoryKey);
      } else {
        newSet.delete(categoryKey);
      }

      // 批量更新该类别下所有元素的可见性
      entityCategoryList.forEach((category) => {
        if (category.key === categoryKey) {
          category.objects.forEach((obj) => {
            obj.visible = isChecked;
          });
        }
      });

      return newSet;
    });
  };

  // ====== 类别全选/取消全选 ======
  const handleCategorySelectAll = (isChecked) => {
    const newSet = new Set();
    // 批量更新所有类别元素
    entityCategoryList.forEach((category) => {
      category.objects.forEach((obj) => {
        obj.visible = isChecked;
      });
      if (isChecked) {
        newSet.add(category.key);
      }
    });
    setCheckedCategoryKeys(newSet);
  };

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

    if (dxfRootRef.current) {
      scene.remove(dxfRootRef.current);
      disposeObject(dxfRootRef.current);
      dxfRootRef.current = null;
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

    // ✅ 原有逻辑：将图形移到原点
    normalizeRootToOriginByLines(root);
    scene.add(root);
    dxfRootRef.current = root;

    // ====== 优化：分类收集数据（LWPOLYLINE按颜色细分） ======
    const entityStats = {}; // 临时分类统计对象
    const dxfBlocks = blocks;

    // 遍历顶层元素，按名称/颜色分类
    root.traverse((obj) => {
      if (obj.userData && obj.userData.isTopLevel) {
        const userData = obj.userData;
        // 调用你提供的函数生成友好名称
        const name = getEntityDisplayName(userData, dxfBlocks);
        // 获取元素颜色（默认ffffff）
        const color = userData.baseColor || 0xffffff;
        // 生成类别唯一Key（LWPOLYLINE包含颜色）
        const categoryKey = getCategoryUniqueKey(userData, name, color);

        // 初始化该类别（若不存在）
        if (!entityStats[categoryKey]) {
          // 对LWPOLYLINE优化显示名称（带颜色）
          // const displayName = userData.type === "LWPOLYLINE" ? getLwpolylineDisplayName(name, color) : name;

          entityStats[categoryKey] = {
            key: categoryKey,
            name,
            type: userData.type,
            blockName: userData.name || "N/A",
            layer: userData.layer || "N/A",
            color: color,
            objects: [], // 存储该类别下所有Three.js对象
            count: 0 // 该类别下对象数量
          };
        }

        // 将当前对象加入该类别
        entityStats[categoryKey].objects.push(obj);
        entityStats[categoryKey].count = entityStats[categoryKey].objects.length;
      }
    });

    // 转换为数组 + 按数量降序排序（参考代码逻辑）
    const newEntityCategoryList = Object.values(entityStats).sort((a, b) => b.count - a.count);
    setEntityCategoryList(newEntityCategoryList);

    // ====== 核心修改：默认选中逻辑（中文名称勾选，非中文不勾选） ======
    const defaultCheckedCategoryKeys = new Set();
    newEntityCategoryList.forEach((category) => {
      // 判断类别名称是否包含中文
      console.log("category.name:", category);
      const isChineseName = isContainChinese(category.name);
      if (isChineseName) {
        // 中文名称：默认勾选，显示元素
        defaultCheckedCategoryKeys.add(category.key);
        category.objects.forEach((obj) => {
          obj.visible = true;
        });
      } else if (isRedColorByHex(category.color) && category.type === "LWPOLYLINE") {
        // 红色元素：默认勾选，显示元素
        defaultCheckedCategoryKeys.add(category.key);
        category.objects.forEach((obj) => {
          obj.visible = true;
        });
      } else {
        // 非中文名称：默认不勾选，隐藏元素
        category.objects.forEach((obj) => {
          obj.visible = false;
        });
      }
    });
    setCheckedCategoryKeys(defaultCheckedCategoryKeys);

    // ✅ 原有逻辑：首次加载适配相机
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

      {/* Detail区域（按类别显示复选框，LWPOLYLINE按颜色细分） */}
      <div className="detail">
        <div className="dxf-detail-panel">
          {/* 头部：标题 + 全选 */}
          <div className="detail-header">
            <h3>图例选择</h3>
            <div className="select-all-wrapper">
              <input
                type="checkbox"
                id="selectAllCategories"
                checked={entityCategoryList.length > 0 && checkedCategoryKeys.size === entityCategoryList.length}
                onChange={(e) => handleCategorySelectAll(e.target.checked)}
              />
              <label htmlFor="selectAllCategories">全选</label>
            </div>
          </div>

          {/* 类别列表 */}
          <div className="entity-category-list">
            {entityCategoryList.length === 0 ? (
              <div className="empty-tip">未找到可统计的DXF元素类别</div>
            ) : (
              entityCategoryList
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((category) => {
                  // 颜色转换为16进制字符串
                  const colorStr = "#" + category.color.toString(16).padStart(6, "0");
                  return (
                    <div key={category.key} className="category-item">
                      {/* 类别复选框 */}
                      <input
                        type="checkbox"
                        id={category.key}
                        checked={checkedCategoryKeys.has(category.key)}
                        onChange={(e) => handleCategoryCheck(category.key, e.target.checked)}
                      />
                      {/* 类别信息（颜色块 + 名称 + 数量） */}
                      <label htmlFor={category.key} className="category-label">
                        <div className="category-color" style={{ background: colorStr }}></div>
                        <div className="category-info">
                          <i>{category.name}</i>
                          <span>{category.count}</span>
                        </div>
                      </label>
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
