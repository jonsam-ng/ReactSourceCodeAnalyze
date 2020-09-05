/*
 * @Descripttion: 
 * @version: 
 * @Author: wuqingshan
 * @Date: 2020-09-05 12:46:30
 * @LastEditors: wuqingshan
 * @LastEditTime: 2020-09-05 13:34:04
 */
import React from "react";

class ToggleLightWithClass extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      light: false,
      music: false
    }
  }
  
  toggleLight = () => {
    this.setState({
      light: !this.state.light
    })
    this.setState({
      music: !this.state.music
    })
  }
  /**
   * 开灯后：
   * 处理更新链表的结果： {light: true, music: true}
   * 关灯后：处理更新链表的结果： {light: false, music: false}
   */
  // 开始处理更新链表：
  // ReactUpdateQueue.js:492 接收参数： workInProgress: Fiber FiberNode {tag: 1, key: null, stateNode: ToggleLightWithClass, elementType: ƒ, type: ƒ, …}actualDuration: 4.010000004200265actualStartTime: 5435.659999988275alternate: FiberNode {tag: 1, key: null, stateNode: ToggleLightWithClass, elementType: ƒ, type: ƒ, …}child: FiberNode {tag: 5, key: null, elementType: "div", type: "div", stateNode: div, …}childExpirationTime: 0dependencies: nulleffectTag: 1elementType: class ToggleLightWithClassexpirationTime: 0firstEffect: FiberNode {tag: 5, key: null, elementType: "button", type: "button", stateNode: button, …}index: 0key: nulllastEffect: FiberNode {tag: 6, key: null, elementType: null, type: null, stateNode: text, …}memoizedProps: {}memoizedState: {light: true, music: true}light: truemusic: true__proto__: Objectmode: 8nextEffect: nullpendingProps: {}ref: nullreturn: FiberNode {tag: 5, key: null, elementType: "div", type: "div", stateNode: div, …}selfBaseDuration: 3.044999990379438sibling: nullstateNode: ToggleLightWithClass {props: {…}, context: {…}, refs: {…}, updater: {…}, toggleLight: ƒ, …}tag: 1treeBaseDuration: 3.4450000093784183type: class ToggleLightWithClassupdateQueue: {baseState: {…}, firstUpdate: null, lastUpdate: null, firstCapturedUpdate: null, lastCapturedUpdate: null, …}_debugHookTypes: null_debugID: 12_debugIsCurrentlyTiming: false_debugNeedsRemount: false_debugOwner: FiberNode {tag: 0, key: null, stateNode: null, elementType: ƒ, type: ƒ, …}_debugSource: {fileName: "/Users/jonsam/Documents/github/ReactSourceCodeAnal…rce-code-demo/src/commponents/componentA/index.js", lineNumber: 28, columnNumber: 7}__proto__: Object queue: UpdateQueue<State> {baseState: {…}, firstUpdate: {…}, lastUpdate: {…}, firstCapturedUpdate: null, lastCapturedUpdate: null, …}baseState: {light: false, music: false}firstCapturedEffect: nullfirstCapturedUpdate: nullfirstEffect: nullfirstUpdate: callback: nullexpirationTime: 1073741823next: {expirationTime: 1073741823, suspenseConfig: null, tag: 0, payload: {…}, callback: null, …}nextEffect: nullpayload: {light: true}priority: 98suspenseConfig: nulltag: 0__proto__: ObjectlastCapturedEffect: nulllastCapturedUpdate: nulllastEffect: nulllastUpdate: {expirationTime: 1073741823, suspenseConfig: null, tag: 0, payload: {…}, callback: null, …}__proto__: Object props: any {} instance ToggleLightWithClass {props: {…}, context: {…}, refs: {…}, updater: {…}, toggleLight: ƒ, …}context: {}props: {}refs: {}state: {light: true, music: true}toggleLight: () => {…}updater: {isMounted: ƒ, enqueueSetState: ƒ, enqueueReplaceState: ƒ, enqueueForceUpdate: ƒ}_reactInternalFiber: FiberNode {tag: 1, key: null, stateNode: ToggleLightWithClass, elementType: ƒ, type: ƒ, …}_reactInternalInstance: {_processChildContext: ƒ}isMounted: (...)replaceState: (...)__proto__: Componentconstructor: class ToggleLightWithClassisMounted: (...)render: render() {     const lightStatus = this.state.light ? 'on' : 'off';     const musicStatus = this.state.music ? "music is playing ..." : "No music .";     return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0___default.a.createElement("div", {       style: {         display: "flex",         flexDirection: "column",         justifyContent: "flex-start",         alignItems: "center"       },       __self: this,       __source: {         fileName: _jsxFileName,         lineNumber: 37,         columnNumber: 12       }     }, "ToggleLightWithClass", /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0___default.a.createElement("button", {       onClick: () => {…}replaceState: (...)__proto__: forceUpdate: ƒ (callback)isReactComponent: {}setState: ƒ (partialState, callback)constructor: ƒ Component(props, context, updater)isMounted: (...)replaceState: (...)get isMounted: ƒ ()get replaceState: ƒ ()__proto__: Object renderExpirationTime 1073741823
  // ReactUpdateQueue.js:560 调用getStateFromUpdate，现在的resultState {light: true, music: false}
  // ReactUpdateQueue.js:560 调用getStateFromUpdate，现在的resultState {light: true, music: true}
  // ReactUpdateQueue.js:662 处理更新链表的结果： {light: true, music: true}

  render() {
    const lightStatus = this.state.light ? 'on' : 'off';
    const musicStatus = this.state.music ? "music is playing ..." : "No music ."
    return <div style={{
      display:"flex",
      flexDirection: "column",
      justifyContent: "flex-start",
      alignItems: "center",
    }}>
      ToggleLightWithClass
      <button onClick={() => this.toggleLight()}>{this.state.light ? "关灯" : "开灯"}</button>
      <div>light is {lightStatus}, {musicStatus}</div>
    </div>
  }
}

export default ToggleLightWithClass;