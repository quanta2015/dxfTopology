import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import DxfParser from "dxf-parser";
import "./Canvas.css";
import {
  getBlocksMap,
  matIdentity,
  boundsFromPaths,
  flattenToPaths,
  buildLinkSets,
  drawId,
  polylineMidPoint,
  rectCenter,
  filterName
} from "./fn";

import { printRoute, strokePolyline, fmt1 } from "./fn2";

const MIN_SCALE = 1;
const MAX_SCALE = 20;
// const LINK_COLOR = "#019c54";
// const BOX_COLOR = "#03c41a";
// const PART_COLOR = "#020289";
// const WIRE_COLOR = "#000000";

const LINK_COLOR = "#bd5ef7";
const BOX_COLOR = "#ffd103";
const PART_COLOR = "#02fc24";
const WIRE_COLOR = "#fa3737";

// 主组件
export default function CanvasViewer() {
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const animRef = useRef(0);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const pathsRef = useRef([]);
  const initialTransformRef = useRef({ scale: 1, cx: 0, cy: 0 });

  // 拖拽相关Ref
  const isDraggingRef = useRef(false); // 是否正在拖拽
  const dragStartRef = useRef({
    mouseX: 0,
    mouseY: 0,
    offsetX: 0,
    offsetY: 0
  }); // 拖拽起始状态

  // UI 相关
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dxfText, setDxfText] = useState("");
  const [err, setErr] = useState("");
  const [routes, setRoutes] = useState([]);

  const parser = useMemo(() => new DxfParser(), []);

  // 核心绘制函数（接收缩放和偏移参数，支持重绘）
  const renderCanvas = useCallback(({ paths, scale, offset }) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !paths.length) return;

    // 重置画布和变换矩阵
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 组合变换：初始居中变换 + 用户缩放偏移变换
    const { scale: initialScale, cx, cy } = initialTransformRef.current;
    ctx.translate(canvas.width / 2, canvas.height / 2); // 画布中心为原点
    ctx.scale(initialScale * scale, -initialScale * scale); // 叠加初始缩放和用户缩放，翻转Y轴
    ctx.translate(-cx + offset.x / (initialScale * scale), -cy - offset.y / (initialScale * scale)); // 叠加偏移

    // 设置线宽（适配总缩放比例，保证线宽视觉一致）
    ctx.lineWidth = 1 / (initialScale * scale);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // 执行绘制逻辑
    drawPaths(ctx, paths);
  }, []);

  // 绘制路径核心逻辑（纯绘制，不处理变换）
  function drawPaths(ctx, paths) {
    let lastColor = "";
    let color;

    // 分类处理
    const eql = [];
    const eqe = [];
    const eqp = [];
    const wire = [];
    const box = [];

    for (const p of paths) {
      const pts = p.points;
      if (!pts || pts.length < 2) continue;

      switch (true) {
        case p.layer.startsWith("EQUIP-照明"):
          eql.push(p);
          color = "#1b1c1b";
          break;
        case p.layer.startsWith("EQUIP-动力"):
          eqe.push(p);
          color = "#017c01";
          break;
        case p.layer.startsWith("EQUIP-插座"):
          eqp.push(p);
          color = "#020289";
          break;
        case p.layer.startsWith("WIRE-照明"):
          wire.push(p);
          color = "#cc0000";
          break;
        default:
          box.push(p);
          color = "#339933";
          break;
      }

      if (color !== lastColor) {
        ctx.strokeStyle = color;
        lastColor = color;
      }
    }

    const linkSets = buildLinkSets({ box, eql, eqe, eqp, wire });

    let count = 0;
    let routeList = [];
    for (const linkSet of linkSets) {
      count++;
      const r = printRoute(linkSet, { decimals: 1, scale: 1 });

      if (r !== undefined) {
        routeList.push(r);
      } else {
        continue;
      }
      console.log(r, "debug");

      // 绘制 wires
      for (const wire of linkSet.wires) {
        ctx.strokeStyle = WIRE_COLOR;
        ctx.beginPath();
        ctx.moveTo(wire.points[0].x, wire.points[0].y);
        for (let i = 1; i < wire.points.length; i++) {
          ctx.lineTo(wire.points[i].x, wire.points[i].y);
        }
        ctx.stroke();

        // 绘制 wire ID
        const mp = polylineMidPoint(wire.points);
        if (mp) drawId(ctx, filterName(wire.__id), mp.x, mp.y, { fill: WIRE_COLOR });
      }

      // 绘制 parts
      for (const part of linkSet.parts) {
        ctx.strokeStyle = PART_COLOR;
        ctx.beginPath();
        ctx.moveTo(part.points[0].x, part.points[0].y);
        for (let i = 1; i < part.points.length; i++) {
          ctx.lineTo(part.points[i].x, part.points[i].y);
        }
        ctx.stroke();

        // 绘制 part ID
        const cp = rectCenter(part.points);
        if (cp) drawId(ctx, filterName(part.__id), cp.x, cp.y, { fill: PART_COLOR });

        // 绘制 part.link
        const links = part.link || [];
        if (links.length) {
          ctx.strokeStyle = LINK_COLOR;
          for (const lk of links) {
            strokePolyline(ctx, lk.points);
            const lm = polylineMidPoint(lk.points);
            if (lm) drawId(ctx, filterName(lk.__id), lm.x, lm.y, { fill: LINK_COLOR });
          }
        }
      }

      // 绘制 boxes
      for (const box of linkSet.boxes) {
        ctx.strokeStyle = BOX_COLOR;
        ctx.beginPath();
        ctx.moveTo(box.points[0].x, box.points[0].y);
        for (let i = 1; i < box.points.length; i++) {
          ctx.lineTo(box.points[i].x, box.points[i].y);
        }
        ctx.stroke();

        // 绘制 box ID
        const bc = rectCenter(box.points);
        if (bc) drawId(ctx, filterName(box.__id), bc.x, bc.y, { fill: BOX_COLOR });
      }
    }

    setRoutes(routeList);
  }

  console.log(routes, "debug");

  // 加载示例DXF文件
  const loadDemo = useCallback(async () => {
    setErr("");
    try {
      const res = await fetch("/demo1.dxf");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDxfText(await res.text());
    } catch (e) {
      setErr(`加载 /demo.dxf 失败：${e?.message ?? String(e)}`);
    }
  }, []);

  // 初始化加载示例
  useEffect(() => {
    loadDemo();
  }, [loadDemo]);

  // DXF解析完成后初始化路径和初始变换
  useEffect(() => {
    if (!dxfText.trim()) return;

    try {
      const dxf = parser.parseSync(dxfText);
      const blocksMap = getBlocksMap(dxf);
      const topEntities = dxf?.entities ?? [];
      const paths = flattenToPaths(dxf, topEntities, blocksMap, "", matIdentity(), 0);
      pathsRef.current = paths; // 保存路径到ref

      // 计算初始居中变换（只计算一次）
      const b = boundsFromPaths(paths);
      const w = canvasRef.current?.width || 1200;
      const h = canvasRef.current?.height || 700;
      const dw = b.maxX - b.minX || 1;
      const dh = b.maxY - b.minY || 1;
      const margin = 0.92;
      const initialScale = Math.min((w / dw) * margin, (h / dh) * margin);

      initialTransformRef.current = {
        scale: initialScale,
        cx: (b.minX + b.maxX) / 2, // 路径中心点X
        cy: (b.minY + b.maxY) / 2 // 路径中心点Y
      };

      // 重置缩放和偏移，初始绘制
      scaleRef.current = 1;
      offsetRef.current = { x: 0, y: 0 };
      setScale(1);
      setOffset({ x: 0, y: 0 });
      renderCanvas({ paths, scale: 1, offset: { x: 0, y: 0 } });
    } catch (e) {
      setErr(`DXF 解析失败：${e?.message ?? String(e)}`);
    }
  }, [dxfText, parser, renderCanvas]);

  // 滚轮缩放 + 鼠标拖拽事件处理
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 滚轮缩放处理
    const handleWheel = (e) => {
      e.preventDefault(); // 阻止页面滚动

      // 获取鼠标在canvas上的相对坐标
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // 计算缩放方向和新缩放值
      const zoomDir = e.deltaY < 0 ? 1 : -1;
      const zoomFactor = 1 + zoomDir * 0.12; // 每次缩放12%
      const currentScale = scaleRef.current;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, currentScale * zoomFactor));

      if (newScale === currentScale) return; // 缩放达到边界，不处理

      // 计算新偏移量（保持鼠标指向的点不变，实现"锚点缩放"）
      const currentOffset = offsetRef.current;
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;

      // 缩放前鼠标在画布上的坐标（考虑当前偏移和缩放）
      const xBefore = (mx - canvasWidth / 2 - currentOffset.x) / (initialTransformRef.current.scale * currentScale);
      const yBefore = (my - canvasHeight / 2 + currentOffset.y) / (initialTransformRef.current.scale * currentScale);

      // 缩放后新的偏移量
      const newOffsetX = mx - canvasWidth / 2 - xBefore * initialTransformRef.current.scale * newScale;
      const newOffsetY = -(my - canvasHeight / 2 - yBefore * initialTransformRef.current.scale * newScale);

      // 更新ref和state
      scaleRef.current = newScale;
      offsetRef.current = { x: newOffsetX, y: newOffsetY };
      setScale(newScale);
      setOffset({ x: newOffsetX, y: newOffsetY });

      // 触发重绘
      renderCanvas({
        paths: pathsRef.current,
        scale: newScale,
        offset: { x: newOffsetX, y: newOffsetY }
      });
    };

    // 拖拽开始：鼠标按下
    const handleMouseDown = (e) => {
      if (e.button !== 0) return; // 只响应左键
      isDraggingRef.current = true;
      const rect = canvas.getBoundingClientRect();
      // 记录起始鼠标位置和当前偏移
      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        offsetX: offsetRef.current.x,
        offsetY: offsetRef.current.y
      };
      canvas.style.cursor = "grabbing"; // 改变光标样式
      e.preventDefault();
    };

    // 拖拽移动：鼠标移动
    const handleMouseMove = (e) => {
      if (!isDraggingRef.current) return;
      // 计算鼠标移动的距离
      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;
      // 新的偏移量 = 起始偏移 + 鼠标移动距离
      const newOffsetX = dragStartRef.current.offsetX + deltaX;
      const newOffsetY = dragStartRef.current.offsetY + deltaY;

      // 更新ref和state
      offsetRef.current = { x: newOffsetX, y: newOffsetY };
      setOffset({ x: newOffsetX, y: newOffsetY });

      // 触发重绘
      renderCanvas({
        paths: pathsRef.current,
        scale: scaleRef.current,
        offset: { x: newOffsetX, y: newOffsetY }
      });
    };

    // 拖拽结束：鼠标松开/离开画布
    const handleMouseUp = () => {
      isDraggingRef.current = false;
      canvas.style.cursor = "zoom-in"; // 恢复光标样式
    };

    const handleMouseLeave = () => {
      isDraggingRef.current = false;
      canvas.style.cursor = "zoom-in"; // 恢复光标样式
    };

    // 绑定事件
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove); // 监听document避免鼠标移出canvas中断
    document.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    // 解绑事件
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [renderCanvas]);

  return (
    <div className="canvas-container" ref={containerRef} style={{ overflow: "hidden", position: "relative" }}>
      {err && <div style={{ color: "red", padding: "8px" }}>{err}</div>}
      <canvas
        className="canvas"
        ref={canvasRef}
        width={1250}
        height={900}
        style={{ cursor: "zoom-in", touchAction: "none" }} // 禁用触摸动作，避免冲突
      />
      <div className="detail">
        {routes.map((item, i) => (
          <div key={i} className="item-container">
            <div className="item-title" style={{ fontWeight: "bold", marginBottom: 4 }}>{`配电箱 ${i + 1}`}</div>
            <div className="item">
              {item.map((node, j) => (
                <div key={j}>{`${filterName(node.nodes.join(" -> "))} = ${fmt1(node.sum)}`}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
