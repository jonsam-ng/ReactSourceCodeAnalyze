<!--
 * @Descripttion: 
 * @version: 
 * @Author: wuqingshan
 * @Date: 2020-09-01 18:27:20
 * @LastEditors: wuqingshan
 * @LastEditTime: 2020-09-07 09:30:45
-->
# ReactSourceCodeAnalyze
> React源码阅读项目

## 基础
### React API
React.js暴露出React的一系列的API。
```js
const React = {
  // ReactChildren提供了处理 this.props.children 的工具集，跟旧版本的一样
  Children: { // 操作ReactChildren的方法。ReactChildren不是数组。模拟数组的一些方法。
    map,
    forEach,
    count,
    toArray,
    only,
  },
  // 旧版本只有ReactComponent一种
  // 新版本定义了三种不同类型的组件基类Component，PureComponent ，unstable_AsyncComponent （16.2.0）
  createRef, // 创建ref用于类组件。
  Component, // 组件
  PureComponent,

  createContext,
  forwardRef, // ref转发
  lazy, // 懒导入
  memo, // 缓存优化

  // -------------------------------------------------- //
  // -------------------------------------------------- //
  // ------------- Hook API       --------------------- //
  // -------------------------------------------------- //
  // -------------------------------------------------- //
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useDebugValue,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,

  Fragment: REACT_FRAGMENT_TYPE,
  Profiler: REACT_PROFILER_TYPE,
  StrictMode: REACT_STRICT_MODE_TYPE, // 严格模式
  Suspense: REACT_SUSPENSE_TYPE, // 与lazy结合使用，指定一个feedback。
  unstable_SuspenseList: REACT_SUSPENSE_LIST_TYPE,
  // 生成组件
  // ! createElement/cloneElement开发环境与产品环境不一样。
  createElement: __DEV__ ? createElementWithValidation : createElement,
  cloneElement: __DEV__ ? cloneElementWithValidation : cloneElement,
  createFactory: __DEV__ ? createFactoryWithValidation : createFactory,
  isValidElement: isValidElement,

  version: ReactVersion,

  unstable_withSuspenseConfig: withSuspenseConfig,

  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: ReactSharedInternals,
};
```
### children的原理
在ReactChildren.js中为children导出了5个方法：forEach、map、count、only、toArray。
```js
export {
  forEachChildren as forEach,
  mapChildren as map,
  countChildren as count,
  onlyChild as only,
  toArray,
};
```
> 参 考：
> - [Children 中 key 内部生成原理](https://juejin.im/post/6844903910285508621)
> 
## setState 更新机制
![setState 更新机制原理图](./assets/images/setState机制.png)
