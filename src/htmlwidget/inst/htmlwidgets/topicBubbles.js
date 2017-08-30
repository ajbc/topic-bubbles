//==============================================================================
// README
//
// Throughout this program, there are two types of nodes: raw data and D3 data.
// The way D3's `hierarchy` functionality works is that it creates a tree from
// the raw data and places each raw data node on a `data` property of each tree
// node. In other words:
//
//     [D3 node].data === [Raw data node]
//
// Any time a node is referenced through D3, for example on a click event, D3
// will pass you a D3 node. View-related properties, such as the (x, y)
// coordinates of a node, are on D3 nodes.
//
// But relationships between nodes are specified by the raw data. D3 just
// updates the view when the raw data changes. For example, if you want to merge
// two nodes, do not touch D3 nodes. Instead, update the raw data and D3 will
// handle rebinding and removing old nodes. For more on this pattern, see:
//
//     https://bl.ocks.org/mbostock/3808218
//
// More concretely, use the function `traveseTree` if you want to inspect every
// raw data node. Then call `update` to update the data binding and view.
//
// Because this distinction is subtle and a little confusing, use the following
// style rules:
//
//     - Use "n" to refer to raw data nodes.
//     - Use "d" to refer to D3 nodes. Note that `d.data === n`.
//     - Avoid "node" unless referring to the concept, e.g. `isRootNode(d)`.
//==============================================================================

HTMLWidgets.widget({


// Variables global to the `HTMLWidgets` instance.
//------------------------------------------------------------------------------

    name: "topicBubbles",
    type: "output",

    PAGE_MARGIN: 30,
    DIAMETER: null,
    FONT_SIZE: 11,

    // The first node the user clicks in the move process.
    source: null,

    // An array of the nodes that the user intends to move. If `source` is a
    // leaf, then `nodesToMove` is an array with just `source`. Otherwise,
    // `nodesToMove` is an array with `source`'s children.
    nodesToMove: null,

    // The parent of the node the user wants to move or merge with `source`.
    // It will become the new parent for either `source` or `source`'s children.
    newParent: null,

    // Used for things like deciding whether to zoom in or out or whether or not
    // to show a label.
    nodeInFocus: null,
    currCoords: null,

    // Used to know when the user has changed the number of groups. In this
    // scenario, we just completely re-initialize the widget.
    nGroups: null,

    el: null,
    svg: null,

    // The raw tree data and final arbiter of node relationships. It is
    // converted to hierarchical data using `d3.hierarchy` and this resulting
    // data structure is what backs the visualization.
    data: null,


// Main functions.
//------------------------------------------------------------------------------

    /* Creates the `svg` element, a `d3.pack` instance with the correct size
     * parameters, and the depth-to-color mapping function.
     */
    initialize: function (el, width, height) {
        var self = this,
            NODE_PADDING = 20,
            SVG_R = width / 2,
            D3PACK_W = width - self.PAGE_MARGIN;

        self.el = el;
        self.DIAMETER = width;

        // Create `svg` and root `g` elements.
        self.g = d3.select(el)
            .append("svg")
            .attr("width", self.DIAMETER)
            .attr("height", self.DIAMETER)
            .append("g")
            .attr("id", "root-node")
            .attr("transform", "translate(" + SVG_R + "," + SVG_R + ")");

        // Create persistent `d3.pack` instance with radii accounting for
        // padding.
        self.pack = d3.pack()
            .size([D3PACK_W, D3PACK_W])
            .padding(NODE_PADDING);

        // Set depth-to-color mapping function.
        self.colorMap = d3.scaleLinear()
            .domain([-1, 1.5])
            .range(["hsl(155,30%,82%)", "hsl(155,66%,25%)"])
            .interpolate(d3.interpolateHcl);
    },

    /* Removes all svg elements and then re-renders everything from scratch.
     */
    reInitialize: function () {
        var self = this;
        d3.select(self.el).selectAll("*").remove();
        self.initialize(self.el, self.DIAMETER, self.DIAMETER);
        self.update(false);
    },

    resize: function (el, width, height) {
        this.initialize(el, width, height);
    },

    renderValue: function (el, rawData) {
        // Shiny calls this function before the user uploads any data. We want
        // to just early-return in this case.
        if (rawData.data == null) {
            return;
        }

        var self = this,
            nGroupsChanged;

        self.data = self.getTreeFromRawData(rawData);
        nGroupsChanged = self.nGroups !== null
            && self.nGroups !== self.data.children.length;
        if (nGroupsChanged) {
            self.reInitialize();
        } else {
            self.nGroups = self.data.children.length;
            this.update(false);
        }
    },

    update: function (useTransition) {
        var self = this,
            nClicks = 0,
            DBLCLICK_DELAY = 300,
            tree,
            nodes,
            circles,
            constancyFn,
            text,
            timer;

        tree = d3.hierarchy(self.data)
            .sum(function (d) {
                return d.weight;
            })
            .sort(function (a, b) {
                return b.value - a.value;
            });
        nodes = self.pack(tree).descendants();
        self.nodeInFocus = nodes[0];

        circles = self.g.selectAll('circle')
            .data(nodes, self.identity);

        circles.enter()
            .append('circle')
            .attr("class", "node")
            .attr("id", function (d) {
                return 'node-' + d.data.id;
            })
            .attr("depth", function (d) {
                return d.depth;
            })
            .on("dblclick", function () {
                d3.event.stopPropagation();
            })
            .on("click", function (d) {
                d3.event.stopPropagation();
                var makeNewGroup = d3.event.shiftKey;
                nClicks++;
                if (nClicks === 1) {
                    timer = setTimeout(function () {
                        self.selectNode(d, makeNewGroup);
                        nClicks = 0;
                    }, DBLCLICK_DELAY);
                } else {
                    clearTimeout(timer);
                    nClicks = 0;
                    self.zoom(tree, d);
                }
            })
            .on("mouseover", function (d) {
                //Shiny.onInputChange("hover", d.data.id);
                if (self.isRootNode(d) || self.isGroupInFocus(d)) {
                    return;
                }
                self.setLabelVisibility(d, true);
            })
            .on("mouseout", function (d) {
                //Shiny.onInputChange("hover", d.data.id);
                if (self.isRootNode(d)) {
                    return;
                }
                self.setLabelVisibility(d, false);
            })
            .each(function (d) {
                self.setCircleFill(d);
            });

        text = self.g.selectAll('text')
            .data(nodes, self.identity);

        text.enter()
            .append('text')
            .attr("class", "label")
            .attr("id", function (d) {
                return 'label-' + d.data.id;
            })
            .attr("depth", function (d) {
                return d.depth;
            })
            .each(function (d) {
                var sel = d3.select(this),
                    len = d.data.terms.length;
                d.data.terms.forEach(function (term, i) {
                    sel.append("tspan")
                        .text(term)
                        .attr("x", 0)
                        .attr("text-anchor", "middle")
                        // This data is used for dynamic sizing of text.
                        .attr("data-term-index", i)
                        .attr("data-term-len", len);
                });
            });

        circles.exit().remove();
        text.exit().remove();

        circles.raise();
        text.raise();

        self.positionAndResizeNodes(
            [tree.x, tree.y, tree.r * 2 + self.PAGE_MARGIN],
            useTransition
        );
    },

    /* Zoom on click.
     */
    zoom: function (root, d) {
        var self = this,
            userClickedSameNodeTwice = self.nodeInFocus === d,
            userClickedDiffNode = self.nodeInFocus !== d;
        if (self.isRootNode(d) || userClickedSameNodeTwice) {
            self.zoomToNode(root);
        } else if (userClickedDiffNode) {
            self.zoomToNode(d);
        }
    },

    /* Zoom to node utility function.
     */
    zoomToNode: function (node) {
        var self = this,
            ZOOM_DURATION = 500,
            coords = [node.x, node.y, node.r * 2 + self.PAGE_MARGIN];
        self.nodeInFocus = node;
        d3.transition()
            .duration(ZOOM_DURATION)
            .tween("zoom", function () {
                var interp = d3.interpolateZoom(self.currCoords, coords);
                return function (t) {
                    // `tween()` will handle the transition for us, so we can
                    // pass `useTransition = false`.
                    self.positionAndResizeNodes(interp(t), false);
                };
            });
    },

    selectNode: function (target, makeNewGroup) {
        var self = this,
            sourceExists = !!self.source,
            souceSelectedTwice,
            moveGroup,
            targetIsSourceParent,
            isDisallowed;

        if (self.isRootNode(target)) {
            return;
        } else if (sourceExists) {
            souceSelectedTwice = self.source === target;
            moveGroup = self.source.children
                && self.source.children.length > 1;
            targetIsSourceParent = self.source.parent === target;
            isDisallowed = self.source.depth < target.depth;
        }

        if (souceSelectedTwice) {
            self.setSource(null);
        } else if (!sourceExists || self.isLeafNode(target)
            || (!moveGroup && targetIsSourceParent) || isDisallowed) {

            self.setSource(target);
        } else {
            self.moveOrMerge(target, makeNewGroup);
            self.updateAssignments();
        }
    },

    moveOrMerge: function (target, makeNewGroup) {
        var self = this,
            targetIsSource = self.source.data.id === target.data.id,
            sourceIsLeaf = self.isLeafNode(self.source),
            mergingNodes = !sourceIsLeaf && self.source.children.length > 1,
            sameParentSel = self.source.parent === target,
            newParentID,
            oldParentID,
            removeSource;

        if (targetIsSource || (sameParentSel && !mergingNodes && !makeNewGroup)) {
            self.setSource(null);
            return;
        }

        if (makeNewGroup) {
            self.traverseTree(self.data, function (n) {
                self.makeNewGroup(n, target);
            });
        } else {
            self.newParent = target;
            newParentID = self.newParent.data.id;
            if (sourceIsLeaf) {
                oldParentID = self.source.parent.data.id;
                self.nodesToMove = [self.source.data];
                removeSource = false;
            } else {
                oldParentID = self.source.data.id;
                var nodesToMove = [];
                self.source.children.forEach(function (d) {
                    nodesToMove.push(d.data);
                });
                self.nodesToMove = nodesToMove;
                removeSource = true;
            }

            self.traverseTree(self.data, function (n) {
                self.updateNodeChildren(n, oldParentID, newParentID);
            });

            if (removeSource) {
                self.traverseTree(self.data, function (n) {
                    self.removeNode(n, self.source.data.id, self.source.parent.data.id);
                });
            }
        }

        self.setSource(null);
        self.nodesToMove = null;
        self.newParent = null;
        self.update(true);
    },

    /* This function "zooms" to center of coordinates. It is important to
     * realize that "zoom" in this context actually means setting the (x, y, r)
     * data for the circles.
     */
    positionAndResizeNodes: function (coords, transition) {
        var self = this,
            MOVE_DURATION = 1000,
            k = self.DIAMETER / coords[2],
            circles = d3.selectAll("circle"),
            text = d3.selectAll('text');
        self.currCoords = coords;

        if (transition) {
            circles = circles.transition().duration(MOVE_DURATION);
            text = text.transition().duration(MOVE_DURATION);
        }

        circles.attr("transform", function (d) {
            var x = (d.x - coords[0]) * k,
                y = (d.y - coords[1]) * k;
            return "translate(" + x + "," + y + ")";
        });
        circles.attr("r", function (d) {
            return d.r * k;
        });
        text.attr("transform", function (d) {
            var x = (d.x - coords[0]) * k,
                y = (d.y - coords[1]) * k;
            return "translate(" + x + "," + y + ")";
        });
        text.attr("display", function (d) {
            self.setLabelVisibility(d);
        });

        text.selectAll("tspan")
            .attr("y", function () {
                var that = d3.select(this),
                    i = +that.attr("data-term-index"),
                    len = +that.attr("data-term-len");
                // `- (len / 2) + 0.75` shifts the term down appropriately.
                // `15 * k` spaces them out appropriately.
                return (self.FONT_SIZE * (k / 2) + 3) * 1.2 * (i - (len / 2) + 0.75);
            })
            .style("font-size", function () {
                return (self.FONT_SIZE * (k / 2) + 3) + "px";
            });
    },

    /* Update node's children depending on whether it is the new or old parent.
     */
    updateNodeChildren: function (n, oldParentID, newParentID) {
        var self = this,
            newChildren;

        // Remove nodes-to-move from old parent.
        if (n.id === oldParentID) {
            // In this scenario, the user selected a leaf node
            // Remove `nodesToMove` from old parent.
            if (self.nodesToMove.length === 1) {
                newChildren = [];
                n.children.forEach(function (child) {
                    if (child.id !== self.nodesToMove[0].id) {
                        newChildren.push(child);
                    }
                });
                n.children = newChildren;
            }
            // In this scenario, the user selected a group of topics;
            // `oldParentID` refers to the selected group; and we're moving all
            // of that group's children.
            else {
                n.children = [];
            }
        }

        // Add nodes-to-move to new parent.
        else if (n.id === newParentID) {
            self.nodesToMove.forEach(function (nodeToMove) {
                n.children.push(nodeToMove);
            });
        }
    },

    /* Remove node from parent if it meets criteria.
     */
    removeNode: function (n, nToRmID, nToRmParentID) {
        var newChildren = [];
        if (n.id === nToRmParentID) {
            n.children.forEach(function (child) {
                if (child.id !== nToRmID) {
                    newChildren.push(child);
                }
            });
            n.children = newChildren;
        }
    },

    /* Make new group with `target` if node meets criteria.
     */
    makeNewGroup: function (n, target) {
        var self = this,
            nIsTarget = n.id === target.data.id,
            nIsSourceParent = n.id === self.source.parent.data.id,
            newChildren;
        if (nIsTarget) {
            n.children.push({
                id: self.getNewID(),
                children: [self.source.data],
                terms: []
            });
        }
        // This is not an `else if` because the user can make a new group by
        // selecting the source node's current parent as the target node. In
        // this case, `n` can be both the target and the `source` parent.
        if (nIsSourceParent) {
            newChildren = [];
            n.children.forEach(function (child) {
                if (child.id !== self.source.data.id) {
                    newChildren.push(child);
                }
            });
            n.children = newChildren;
        }
    },

    /* Sets `source` with new value, resetting and setting circle and label fill
     * and visibility.
     */
    setSource: function (newVal) {
        var self = this,
            oldVal = self.source;
        self.source = newVal;
        if (oldVal) {
            self.setLabelVisibility(oldVal);
            self.setCircleFill(oldVal);
        }
        if (newVal) {
            self.setLabelVisibility(self.source);
            self.setCircleFill(self.source);
        }
    },

    /* Correctly color any node.
     */
    setCircleFill: function (d) {
        var self = this,
            isfirstSelNode = self.source
                && self.source.data.id === d.data.id,
            borderColor = null,
            fillColor;
        if (isfirstSelNode) {
            borderColor = "rgb(12, 50, 127)";
            fillColor = "rgb(25, 101, 255)";
        } else if (d.children) {
            fillColor = self.colorMap(d.depth);
        } else {
            fillColor = "rgb(255, 255, 255)";
        }
        d3.select("#node-" + d.data.id)
            .style("fill", fillColor)
            .style("stroke", borderColor)
            .style("stroke-width", 2);
    },

    /* Correctly label any node.
     */
    setLabelVisibility: function (d, hover) {
        var self = this,
            dIs = !!d,
            dIsSource = dIs && self.source && d.data.id === self.source.data.id,
            parentInFocus = dIs && d.depth === self.nodeInFocus.depth + 1,
            isLeaf = dIs && self.isLeafNode(d),
            isInFocus = dIs && d === self.nodeInFocus,
            zoomedOnLeaf = isInFocus && isLeaf && !self.isRootNode(d),
            label = d3.select('#label-' + d.data.id);

        if (dIsSource || parentInFocus || hover || zoomedOnLeaf) {
            label.style("display", "inline");
        } else {
            label.style("display", "none");
        }
    },

    /* Traverse the underlying tree data structure and apply a callback
     * function to every node.
     */
    traverseTree: function (node, processNode) {
        var self = this;
        processNode(node);
        if (typeof node.children !== "undefined") {
            node.children.forEach(function (childNode) {
                self.traverseTree(childNode, processNode)
            });
        }
    },

    /* Convert R dataframe to tree.
     */
    getTreeFromRawData: function (x) {
        var self = this,
            data = {id: "root", children: [], terms: []},
            srcData = HTMLWidgets.dataframeToD3(x.data);

        // For each data row add to the output tree.
        srcData.forEach(function (d) {
            var parent = self.findParent(data, d.parentID, d.nodeID);

            // Leaf node.
            if (d.weight === 0) {
                parent.children.push({
                    id: d.nodeID,
                    terms: d.title.split(" "),
                    children: []
                });
            } else if (parent !== null && parent.hasOwnProperty("children")) {
                parent.children.push({
                    id: d.nodeID,
                    terms: d.title.split(" "),
                    weight: d.weight
                });
            }
        });

        return data;
    },

    /* Helper function for updateAssignments
     */
    findAssignments: function (n) {
        var self = this,
            assignments = "",
            assignment;

        n.children.forEach(function (d) {
            assignment = "".concat(d.data.id, ":", (self.isRootNode(n)) ? 0 : n.data.id);
            assignments = assignments.concat(assignment, ",");

            //TODO: check that this works for hierarchy
            if (d.hasOwnProperty("children"))
                assignments = assignments.concat(self.findAssignments(d));
        });

        return assignments;
    },

    /* Update the string that informs the Shiny server about the hierarchy of
     * topic assignemnts
     */
    updateAssignments: function () {
        var self = this,
            root = d3.hierarchy(self.data);
        //Shiny.onInputChange("topics", self.findAssignments(root));
    },

    /* Helper function to add hierarchical structure to data.
     */
    findParent: function (branch, parentID, nodeID) {
        var self = this;
        if (parentID === 0) {
            parentID = "root";
        }
        var rv = null;
        if (branch.id == parentID) {
            rv = branch;
        } else if (rv === null && branch.children !== undefined) {
            branch.children.forEach(function (child) {
                if (rv === null) {
                    rv = self.findParent(child, parentID, nodeID);
                }
            });
        }
        return rv;
    },

    /* Finds the maximum node ID and returns the next integer.
     */
    getNewID: function () {
        var self = this,
            maxId = 0;
        self.traverseTree(self.data, function (n) {
            if (n.id > maxId) {
                maxId = n.id;
            }
        });
        return maxId + 1;
    },

    /* Returns `true` if the node is the root node, `false` otherwise.
     */
    isRootNode: function (d) {
        return d.data.id === "root";
    },

    /* Returns `true` if the node is a leaf node, `false` otherwise.
     */
    isLeafNode: function (d) {
        if (d.data.children) {
            return d.data.children.length > 1;
        } else {
            return false;
        }
    },

    /* Returns `true` if the node is both in focus and a group rather than a
     * leaf.
     */
    isGroupInFocus: function (d) {
        var self = this,
            isInFocus = d === self.nodeInFocus,
            isGroup = !self.isLeafNode(d);
        return isInFocus && isGroup;
    },

    /* This is a critical function. We need to give D3 permanent IDs for each
     * node so that it knows which data goes with which bubble. See:
     * https://bost.ocks.org/mike/constancy/
     */
    identity: function (d) {
        return d.data.id;
    }
});
