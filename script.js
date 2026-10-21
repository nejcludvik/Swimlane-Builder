let stageCount = 0;
let laneCount = 0;
let shapeCount = 0;
let zIndexCounter = 100;

let connections = [];
let isConnecting = false;
let connectionStartShapeId = null;
let connectionStartPort = null;

window.onload = () => {
    addStage('Stage 1: Project Initiation');
    addStage('Stage 2: Development');
    addStage('Stage 3: Verification');
    
    addLane('Product Manager');
    addLane('Head of Development');
    addLane('HW Dev Team Lead');
    addLane('Embedded Sys Developer');
};

// 1. Save & Load Functions
function saveDiagram() {
    const colWidth = document.getElementById('colWidth').value;
    const rowHeight = document.getElementById('rowHeight').value;

    const stages = [];
    document.querySelectorAll('#stages-header .stage-title').forEach(el => {
        stages.push(el.querySelector('.editable-text').innerText);
    });

    const lanes = [];
    document.querySelectorAll('#lanes-wrapper .lane-title').forEach(el => {
        lanes.push(el.querySelector('.editable-text').innerText);
    });

    const shapes = [];
    document.querySelectorAll('.shape').forEach(el => {
        let shapeType = 'process';
        if (el.classList.contains('decision')) shapeType = 'decision';
        else if (el.classList.contains('text-label')) shapeType = 'text';

        shapes.push({
            id: el.id,
            type: shapeType,
            left: el.style.left,
            top: el.style.top,
            zIndex: el.style.zIndex,
            text: el.querySelector('.shape-content').innerText
        });
    });

    const diagramData = {
        colWidth,
        rowHeight,
        stages,
        lanes,
        shapes,
        connections
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(diagramData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "diagram.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function loadDiagram(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            restoreDiagramState(data);
        } catch (err) {
            alert('Invalid diagram file format.');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function restoreDiagramState(data) {
    document.getElementById('stages-header').innerHTML = '';
    document.getElementById('lanes-wrapper').innerHTML = '';
    document.querySelectorAll('.shape').forEach(s => s.remove());
    connections = [];

    if (data.colWidth) document.getElementById('colWidth').value = data.colWidth;
    if (data.rowHeight) document.getElementById('rowHeight').value = data.rowHeight;
    updateGridSize();

    stageCount = 0;
    if (data.stages) data.stages.forEach(s => addStage(s));

    laneCount = 0;
    if (data.lanes) data.lanes.forEach(l => addLane(l));

    shapeCount = 0;
    let maxIdNum = 0;
    let maxZ = 100;

    if (data.shapes) {
        data.shapes.forEach(sData => {
            const num = parseInt(sData.id.replace('shape-', '')) || 0;
            if (num > maxIdNum) maxIdNum = num;
            const z = parseInt(sData.zIndex) || 100;
            if (z > maxZ) maxZ = z;

            addShapeWithData(sData);
        });
    }

    shapeCount = maxIdNum;
    zIndexCounter = maxZ + 1;

    if (data.connections && Array.isArray(data.connections)) {
        connections = data.connections;
    }

    drawArrows();
}

function addShapeWithData(sData) {
    const container = document.getElementById('shapes-container');
    const shapeId = sData.id;
    
    const shape = document.createElement('div');
    shape.className = `shape ${sData.type === 'text' ? 'text-label' : sData.type}`;
    shape.style.left = sData.left || '40px';
    shape.style.top = sData.top || '40px';
    shape.style.zIndex = sData.zIndex || 100;
    shape.id = shapeId;

    if (sData.type === 'decision') {
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("class", "decision-svg");
        svg.setAttribute("viewBox", "0 0 100 100");
        svg.setAttribute("preserveAspectRatio", "none");

        const polygon = document.createElementNS(svgNS, "polygon");
        polygon.setAttribute("points", "50,2 98,50 50,98 2,50");
        polygon.setAttribute("fill", "#fffbeb");
        polygon.setAttribute("stroke", "#1e293b");
        polygon.setAttribute("stroke-width", "2");
        polygon.setAttribute("vector-effect", "non-scaling-stroke");

        svg.appendChild(polygon);
        shape.appendChild(svg);
    }

    const textDiv = document.createElement('div');
    textDiv.contentEditable = true;
    textDiv.innerText = sData.text || '';
    textDiv.className = 'shape-content';
    textDiv.onmousedown = (e) => e.stopPropagation();
    textDiv.onkeydown = (e) => e.stopPropagation();

    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.setAttribute('data-html2canvas-ignore', 'true');
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        shape.remove();
        connections = connections.filter(c => c.from !== shapeId && c.to !== shapeId);
        drawArrows();
    };

    if (sData.type !== 'text') {
        const ports = ['top', 'right', 'bottom', 'left'];
        ports.forEach(portPos => {
            const port = document.createElement('div');
            port.className = `port ${portPos}`;
            port.setAttribute('data-html2canvas-ignore', 'true');
            port.onmousedown = (e) => startConnectionDrag(e, shapeId, portPos);
            shape.appendChild(port);
        });
    }

    shape.appendChild(deleteBtn);
    shape.appendChild(textDiv);
    container.appendChild(shape);

    makeDraggable(shape);
}

// 2. Selection & Alignment Functions
function handleCanvasClick(e) {
    if (e.target.id === 'scroll-container' || e.target.id === 'diagram-wrapper' || e.target.classList.contains('lane-cell')) {
        clearSelections();
    }
}

function clearSelections() {
    document.querySelectorAll('.shape.selected').forEach(s => s.classList.remove('selected'));
}

function alignShapes(type) {
    const selected = Array.from(document.querySelectorAll('.shape.selected'));
    if (selected.length < 2) {
        alert('Please select at least 2 shapes (Hold Shift + Click shapes) to align them.');
        return;
    }

    let minLeft = Infinity, maxRight = -Infinity;
    let minTop = Infinity, maxBottom = -Infinity;

    selected.forEach(el => {
        const l = el.offsetLeft;
        const r = el.offsetLeft + el.offsetWidth;
        const t = el.offsetTop;
        const b = el.offsetTop + el.offsetHeight;

        if (l < minLeft) minLeft = l;
        if (r > maxRight) maxRight = r;
        if (t < minTop) minTop = t;
        if (b > maxBottom) maxBottom = b;
    });

    const centerX = minLeft + (maxRight - minLeft) / 2;
    const centerY = minTop + (maxBottom - minTop) / 2;

    // Apply alignment only based on centers
    selected.forEach(el => {
        if (type === 'center-h') {
            el.style.left = (centerX - el.offsetWidth / 2) + 'px';
        } else if (type === 'middle-v') {
            el.style.top = (centerY - el.offsetHeight / 2) + 'px';
        }
    });

    drawArrows();
}

// 3. Arrow Connection & Dragging Logic
function startConnectionDrag(e, shapeId, portName) {
    e.stopPropagation();
    e.preventDefault();

    isConnecting = true;
    connectionStartShapeId = shapeId;
    connectionStartPort = portName;

    document.addEventListener('mousemove', handleConnectionMouseMove);
    document.addEventListener('mouseup', handleConnectionMouseUp);
}

function handleConnectionMouseMove(e) {
    if (!isConnecting) return;

    const shapesContainer = document.getElementById('shapes-container');
    const containerRect = shapesContainer.getBoundingClientRect();

    const fromEl = document.getElementById(connectionStartShapeId);
    if (!fromEl) return;

    const startX = fromEl.offsetLeft + (fromEl.offsetWidth / 2);
    const startY = fromEl.offsetTop + (fromEl.offsetHeight / 2);

    const currentX = e.clientX - containerRect.left;
    const currentY = e.clientY - containerRect.top;

    drawTempArrow(startX, startY, currentX, currentY);

    const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
    const targetShape = elementUnderCursor ? elementUnderCursor.closest('.shape') : null;

    document.querySelectorAll('.shape').forEach(s => s.classList.remove('target-hover'));
    if (targetShape && targetShape.id !== connectionStartShapeId && !targetShape.classList.contains('text-label')) {
        targetShape.classList.add('target-hover');
    }
}

function handleConnectionMouseUp(e) {
    if (!isConnecting) return;

    const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
    const targetShape = elementUnderCursor ? elementUnderCursor.closest('.shape') : null;

    if (targetShape && targetShape.id !== connectionStartShapeId && !targetShape.classList.contains('text-label')) {
        connections.push({ from: connectionStartShapeId, to: targetShape.id });
    }

    isConnecting = false;
    connectionStartShapeId = null;
    connectionStartPort = null;

    document.querySelectorAll('.shape').forEach(s => s.classList.remove('target-hover'));
    removeTempArrow();
    drawArrows();

    document.removeEventListener('mousemove', handleConnectionMouseMove);
    document.removeEventListener('mouseup', handleConnectionMouseUp);
}

function drawTempArrow(startX, startY, currentX, currentY) {
    const svg = document.getElementById('arrows-svg');
    let tempPath = document.getElementById('temp-path');

    if (!tempPath) {
        tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        tempPath.setAttribute("id", "temp-path");
        tempPath.setAttribute("fill", "none");
        tempPath.setAttribute("stroke", "#3b82f6");
        tempPath.setAttribute("stroke-width", "2");
        tempPath.setAttribute("stroke-dasharray", "5 5");
        tempPath.setAttribute("marker-end", "url(#arrowhead-temp)");
        svg.appendChild(tempPath);
    }

    let pathString = "";
    if (Math.abs(startX - currentX) > Math.abs(startY - currentY)) {
        const midX = (startX + currentX) / 2;
        pathString = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${currentY} L ${currentX} ${currentY}`;
    } else {
        const midY = (startY + currentY) / 2;
        pathString = `M ${startX} ${startY} L ${startX} ${midY} L ${currentX} ${midY} L ${currentX} ${currentY}`;
    }

    tempPath.setAttribute("d", pathString);
}

function removeTempArrow() {
    const tempPath = document.getElementById('temp-path');
    if (tempPath) tempPath.remove();
}

function drawArrows() {
    const svg = document.getElementById('arrows-svg');
    const defs = svg.querySelector('defs').outerHTML;
    const guidesGroup = svg.querySelector('#guides-group').outerHTML;
    svg.innerHTML = defs + guidesGroup;

    connections.forEach((conn, index) => {
        const fromEl = document.getElementById(conn.from);
        const toEl = document.getElementById(conn.to);
        
        if (!fromEl || !toEl) return;

        const rectA = {
            left: fromEl.offsetLeft,
            top: fromEl.offsetTop,
            width: fromEl.offsetWidth,
            height: fromEl.offsetHeight,
            right: fromEl.offsetLeft + fromEl.offsetWidth,
            bottom: fromEl.offsetTop + fromEl.offsetHeight,
            centerX: fromEl.offsetLeft + (fromEl.offsetWidth / 2),
            centerY: fromEl.offsetTop + (fromEl.offsetHeight / 2)
        };

        const rectB = {
            left: toEl.offsetLeft,
            top: toEl.offsetTop,
            width: toEl.offsetWidth,
            height: toEl.offsetHeight,
            right: toEl.offsetLeft + toEl.offsetWidth,
            bottom: toEl.offsetTop + toEl.offsetHeight,
            centerX: toEl.offsetLeft + (toEl.offsetWidth / 2),
            centerY: toEl.offsetTop + (toEl.offsetHeight / 2)
        };

        let startX, startY, endX, endY;
        let pathString = "";

        if (Math.abs(rectA.centerX - rectB.centerX) > Math.abs(rectA.centerY - rectB.centerY)) {
            if (rectA.centerX < rectB.centerX) {
                startX = rectA.right;
                startY = rectA.centerY;
                endX = rectB.left;
                endY = rectB.centerY;
            } else {
                startX = rectA.left;
                startY = rectA.centerY;
                endX = rectB.right;
                endY = rectB.centerY;
            }
            const midX = (startX + endX) / 2;
            pathString = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
        } else {
            if (rectA.centerY < rectB.centerY) {
                startX = rectA.centerX;
                startY = rectA.bottom;
                endX = rectB.centerX;
                endY = rectB.top;
            } else {
                startX = rectA.centerX;
                startY = rectA.top;
                endX = rectB.centerX;
                endY = rectB.bottom;
            }
            const midY = (startY + endY) / 2;
            pathString = `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;
        }

        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("class", "connection-group");

        const hoverPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        hoverPath.setAttribute("d", pathString);
        hoverPath.setAttribute("fill", "none");
        hoverPath.setAttribute("stroke", "transparent");
        hoverPath.setAttribute("stroke-width", "20");
        hoverPath.style.pointerEvents = "stroke";

        const visiblePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        visiblePath.setAttribute("class", "visible-path");
        visiblePath.setAttribute("d", pathString);
        visiblePath.setAttribute("fill", "none");
        visiblePath.setAttribute("stroke", "#475569");
        visiblePath.setAttribute("stroke-width", "2");
        visiblePath.setAttribute("stroke-linejoin", "round");
        visiblePath.setAttribute("marker-end", "url(#arrowhead)");

        const btnX = (startX + endX) / 2;
        const btnY = (startY + endY) / 2;

        const btnGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        btnGroup.setAttribute("class", "delete-arrow-btn");
        btnGroup.setAttribute("transform", `translate(${btnX}, ${btnY})`);

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", "10");
        circle.setAttribute("fill", "#ef4444");

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", "0");
        text.setAttribute("y", "4");
        text.setAttribute("fill", "white");
        text.setAttribute("font-size", "14");
        text.setAttribute("font-weight", "bold");
        text.setAttribute("text-anchor", "middle");
        text.textContent = "×";

        btnGroup.appendChild(circle);
        btnGroup.appendChild(text);

        group.appendChild(hoverPath);
        group.appendChild(visiblePath);
        group.appendChild(btnGroup);

        group.addEventListener('click', (e) => {
            e.stopPropagation();
            connections.splice(index, 1);
            drawArrows(); 
        });
        
        svg.appendChild(group);
    });
}

// 4. Grid Management
function updateGridSize() {
    const width = document.getElementById('colWidth').value;
    const height = document.getElementById('rowHeight').value;
    if (width >= 100) document.documentElement.style.setProperty('--stage-width', width + 'px');
    if (height >= 50) document.documentElement.style.setProperty('--lane-height', height + 'px');
    drawArrows();
}

function addStage(titleText) {
    stageCount++;
    const text = typeof titleText === 'string' ? titleText : `New Stage ${stageCount}`;
    const header = document.getElementById('stages-header');
    
    const stage = document.createElement('div');
    stage.className = 'stage-title';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'editable-text';
    textDiv.contentEditable = true;
    textDiv.innerText = text;
    textDiv.onmousedown = (e) => e.stopPropagation();
    textDiv.onkeydown = (e) => e.stopPropagation();

    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'delete-grid-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.setAttribute('data-html2canvas-ignore', 'true');
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        const index = Array.from(header.children).indexOf(stage);
        stage.remove();
        const lanes = document.querySelectorAll('.lane-cells');
        lanes.forEach(lane => {
            if(lane.children[index]) lane.children[index].remove();
        });
        drawArrows(); 
    };

    stage.appendChild(deleteBtn);
    stage.appendChild(textDiv);
    header.appendChild(stage);

    const lanes = document.querySelectorAll('.lane-cells');
    lanes.forEach(lane => {
        const cell = document.createElement('div');
        cell.className = 'lane-cell';
        lane.appendChild(cell);
    });
}

function addLane(titleText) {
    laneCount++;
    const text = typeof titleText === 'string' ? titleText : `New Role ${laneCount}`;
    const wrapper = document.getElementById('lanes-wrapper');
    
    const laneContainer = document.createElement('div');
    laneContainer.className = 'lane-container';

    const laneTitle = document.createElement('div');
    laneTitle.className = 'lane-title';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'editable-text';
    textDiv.contentEditable = true;
    textDiv.innerText = text;
    textDiv.onmousedown = (e) => e.stopPropagation();
    textDiv.onkeydown = (e) => e.stopPropagation();

    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'delete-grid-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.setAttribute('data-html2canvas-ignore', 'true');
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        laneContainer.remove();
        drawArrows();
    };

    laneTitle.appendChild(deleteBtn);
    laneTitle.appendChild(textDiv);

    const laneCells = document.createElement('div');
    laneCells.className = 'lane-cells';
    
    const currentColumns = document.getElementById('stages-header').children.length;
    for(let i = 0; i < currentColumns; i++) {
        const cell = document.createElement('div');
        cell.className = 'lane-cell';
        laneCells.appendChild(cell);
    }

    laneContainer.appendChild(laneTitle);
    laneContainer.appendChild(laneCells);
    wrapper.appendChild(laneContainer);
}

function addShape(type) {
    shapeCount++;
    let defaultText = 'Process Step';
    let offsetX = 60; // Half of process width
    let offsetY = 30; // Half of process height
    
    if (type === 'decision') {
        defaultText = 'Decision';
        offsetX = 70;
        offsetY = 50;
    } else if (type === 'text') {
        defaultText = 'YES';
        offsetX = 20;
        offsetY = 14;
    }

    const scrollContainer = document.getElementById('scroll-container');
    const scrollRect = scrollContainer.getBoundingClientRect();
    
    const visibleCenterX = scrollRect.left + (scrollRect.width / 2);
    const visibleCenterY = scrollRect.top + (scrollRect.height / 2);
    
    const shapesContainer = document.getElementById('shapes-container');
    const shapesRect = shapesContainer.getBoundingClientRect();
    
    let leftPos = visibleCenterX - shapesRect.left - offsetX;
    let topPos = visibleCenterY - shapesRect.top - offsetY;

    if (leftPos < 20) leftPos = 20;
    if (topPos < 20) topPos = 20;

    addShapeWithData({
        id: `shape-${shapeCount}`,
        type: type,
        left: leftPos + 'px',
        top: topPos + 'px',
        zIndex: zIndexCounter++,
        text: defaultText
    });
}

function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    element.addEventListener('mousedown', dragMouseDown);

    function dragMouseDown(e) {
        if (e.target.contentEditable === 'true' || e.target.classList.contains('port') || e.target.classList.contains('delete-btn')) return;
        
        if (e.shiftKey) {
            element.classList.toggle('selected');
        } else {
            if (!element.classList.contains('selected')) {
                clearSelections();
                element.classList.add('selected');
            }
        }

        element.style.zIndex = zIndexCounter++;
        pos3 = e.clientX;
        pos4 = e.clientY;

        document.addEventListener('mouseup', closeDragElement);
        document.addEventListener('mousemove', elementDrag);
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        
        let newTop = element.offsetTop - pos2;
        let newLeft = element.offsetLeft - pos1;

        const SNAP_THRESHOLD = 8; // Slightly larger snap radius for ease of use
        const otherShapes = Array.from(document.querySelectorAll('.shape')).filter(s => s.id !== element.id);
        
        let snapX = null;
        let snapY = null;

        const myWidth = element.offsetWidth;
        const myHeight = element.offsetHeight;
        
        // Only evaluate centers now
        const myCenterX = newLeft + (myWidth / 2);
        const myCenterY = newTop + (myHeight / 2);

        // Snap X to center
        otherShapes.forEach(other => {
            const oCenterX = other.offsetLeft + (other.offsetWidth / 2);
            if (Math.abs(myCenterX - oCenterX) < SNAP_THRESHOLD) {
                newLeft = oCenterX - (myWidth / 2);
                snapX = oCenterX;
            }
        });

        // Snap Y to middle
        otherShapes.forEach(other => {
            const oCenterY = other.offsetTop + (other.offsetHeight / 2);
            if (Math.abs(myCenterY - oCenterY) < SNAP_THRESHOLD) {
                newTop = oCenterY - (myHeight / 2);
                snapY = oCenterY;
            }
        });

        element.style.top = newTop + "px";
        element.style.left = newLeft + "px";
        
        renderAlignmentGuides(snapX, snapY);
        drawArrows();
    }

    function closeDragElement() {
        clearAlignmentGuides();
        document.removeEventListener('mouseup', closeDragElement);
        document.removeEventListener('mousemove', elementDrag);
    }
}

function renderAlignmentGuides(x, y) {
    const group = document.getElementById('guides-group');
    group.innerHTML = '';

    if (x !== null) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x);
        line.setAttribute("y1", "0");
        line.setAttribute("x2", x);
        line.setAttribute("y2", "2000");
        line.setAttribute("stroke", "#ec4899");
        line.setAttribute("stroke-width", "1.5");
        line.setAttribute("stroke-dasharray", "4 4");
        group.appendChild(line);
    }

    if (y !== null) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", "0");
        line.setAttribute("y1", y);
        line.setAttribute("x2", "2000");
        line.setAttribute("y2", y);
        line.setAttribute("stroke", "#ec4899");
        line.setAttribute("stroke-width", "1.5");
        line.setAttribute("stroke-dasharray", "4 4");
        group.appendChild(line);
    }
}

function clearAlignmentGuides() {
    const group = document.getElementById('guides-group');
    if (group) group.innerHTML = '';
}

function exportPNG() {
    clearSelections();
    clearAlignmentGuides();
    
    const editables = document.querySelectorAll('[contenteditable="true"]');
    editables.forEach(el => el.setAttribute('contenteditable', 'false'));

    const wrapper = document.getElementById('diagram-wrapper');
    const scrollContainer = document.getElementById('scroll-container');
    
    const originalScrollLeft = scrollContainer.scrollLeft;
    const originalScrollTop = scrollContainer.scrollTop;

    html2canvas(wrapper, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = 'swimlane-diagram.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        
        scrollContainer.scrollLeft = originalScrollLeft;
        scrollContainer.scrollTop = originalScrollTop;

        editables.forEach(el => el.setAttribute('contenteditable', 'true'));
    }).catch(() => {
        editables.forEach(el => el.setAttribute('contenteditable', 'true'));
    });
}