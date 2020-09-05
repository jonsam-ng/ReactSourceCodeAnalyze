/*
 * @Descripttion: 
 * @version: 
 * @Author: wuqingshan
 * @Date: 2020-09-01 18:27:20
 * @LastEditors: wuqingshan
 * @LastEditTime: 2020-09-05 12:49:46
 */
import React from 'react';
import logo from './logo.svg';
import ComponentA from "./commponents/componentA";
import './App.css';

function App() {
  // const {forEach} = Children; // 操作ReactChildren的方法。
  // const ref = createRef();
  // console.log(typeof ref); // object
  return (
    <div className="App">
      {/* <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Edit <code>src/App.js</code> and save to reload.
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
      </header> */}
      <ComponentA></ComponentA>
    </div>
  );
}
console.log('组价是什么？', <App>我是组件<App /></App>);
// 组价是一个整体
// {$$typeof: Symbol(react.element), key: null, ref: null, props: {…}, type: ƒ, …}
// $$typeof: Symbol(react.element)
// key: null
// props:
// __proto__: Object
// ref: null
// type: ƒ App()
// arguments: (...)
// caller: (...)
// length: 0
// name: "App"
// prototype: {constructor: ƒ}
// __proto__: ƒ ()
// [[FunctionLocation]]: App.js:13
// [[Scopes]]: Scopes[2]
// 0: Closure (./src/App.js) {_jsxFileName: "/Users/jonsam/Documents/github/ReactSourceCodeAnalyze/source-code-demo/src/App.js", react__WEBPACK_IMPORTED_MODULE_0___default: ƒ, _logo_svg__WEBPACK_IMPORTED_MODULE_1___default: ƒ}
// 1: Global {parent: Window, opener: null, top: Window, length: 0, frames: Window, …}
// _owner: null
// _store: {validated: false}
// _self: null
// _source: {fileName: "/Users/jonsam/Documents/github/ReactSourceCodeAnalyze/source-code-demo/src/App.js", lineNumber: 34}
// __proto__: Object
// ====================== 》》》》
// ! children中可以包含组件，但是text不被视为组件，因为其没有$$typeof属性。
// props:
// children: "我是组件"
// __proto__: Object
// ref: null
// ======================>>>>>>>
// props:
// children: Array(2)
// 0: "我是组件"
// 1: {$$typeof: Symbol(react.element), key: null, ref: null, props: {…}, type: ƒ, …}
// length: 2
// __proto__: Array(0)
// ! 组件本质上是对象，具有props属性，可以挂载组件树。组件通过props形成树。
export default App;
