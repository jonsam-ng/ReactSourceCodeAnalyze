/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import invariant from 'shared/invariant';
import warning from 'shared/warning';
import {
  getIteratorFn,
  REACT_ELEMENT_TYPE,
  REACT_PORTAL_TYPE,
} from 'shared/ReactSymbols';

import {isValidElement, cloneAndReplaceKey} from './ReactElement';
import ReactDebugCurrentFrame from './ReactDebugCurrentFrame';

const SEPARATOR = '.';
const SUBSEPARATOR = ':';

/**
 * Escape and wrap key so it is safe to use as a reactid
 *
 * @param {string} key to be escaped.
 * @return {string} the escaped key.
 */
function escape(key) {
  // 匹配等号和冒号，替换为=0或=2，加上$返回。
  const escapeRegex = /[=:]/g;
  const escaperLookup = {
    '=': '=0',
    ':': '=2',
  };
  const escapedString = ('' + key).replace(escapeRegex, function(match) {
    return escaperLookup[match];
  });

  return '$' + escapedString;
}

/**
 * TODO: Test that a single child and an array with one item have the same key
 * pattern.
 */

let didWarnAboutMaps = false;

const userProvidedKeyEscapeRegex = /\/+/g;
function escapeUserProvidedKey(text) {
  return ('' + text).replace(userProvidedKeyEscapeRegex, '$&/');
}

// getPooledTraverseContext 和 releaseTraverseContext，这两个函数是用来维护一个对象池，
// 池子最大为10。Children 需要频繁的创建对象会导致性能问题，
// 所以维护一个固定数量的对象池，每次从对象池拿一个对象进行复制，使用完将各个属性 reset。
/**
 * 返回遍历的context，维持一个遍历环境池traverseContextPool，
 * 当池为空时，返回新建的context，返回pop一个context返回
 * traverseContext.count = 0
 */
// 返回一个传入参数构成的对象
// traverseContextPool 长度为 0 则自己构造一个对象出来，否则从 traverseContextPool pop 一个对象
// 再对这个对象的各个属性进行赋值
const POOL_SIZE = 10; // 遍历环境池容量为10
const traverseContextPool = [];
// 传参：array,escapedPrefix,func,context,
function getPooledTraverseContext(
  mapResult,
  keyPrefix,
  mapFunction,
  mapContext,
) {
  if (traverseContextPool.length) {
    const traverseContext = traverseContextPool.pop();
    traverseContext.result = mapResult;
    traverseContext.keyPrefix = keyPrefix;
    traverseContext.func = mapFunction;
    traverseContext.context = mapContext;
    traverseContext.count = 0;
    return traverseContext;
  } else {
    return {
      result: mapResult,
      keyPrefix: keyPrefix,
      func: mapFunction,
      context: mapContext,
      count: 0,
    };
  }
}

// 释放当前的traverseContext对象，将之reset，
// 如果traverseContextPool的容量小于10，将容量池补满
function releaseTraverseContext(traverseContext) {
  traverseContext.result = null;
  traverseContext.keyPrefix = null;
  traverseContext.func = null;
  traverseContext.context = null;
  traverseContext.count = 0;
  if (traverseContextPool.length < POOL_SIZE) {
    traverseContextPool.push(traverseContext);
  }
}

/**
 * @param {?*} children Children tree container.
 * @param {!string} nameSoFar Name of the key path so far.这里传了''。
 * @param {!function} callback Callback to invoke with each child found.
 * @param {?*} traverseContext Used to pass information throughout the traversal
 * process.
 * @return {!number} The number of children in this subtree.
 */
// • children 是可渲染节点，则调用 mapSingleChildIntoContext 把 children 推入 result 数组中
// • children 是数组，则再次对数组中的每个元素调用 traverseAllChildrenImpl，传入的 key 是最新拼接好的
// • children 是对象，则通过 children[Symbol.iterator] 获取到对象的迭代器 iterator， 将迭代的结果放到 traverseAllChildrenImpl 处理
// 函数核心作用就是通过把传入的 children 数组通过遍历摊平成单个节点，然后去执行 mapSingleChildIntoContext。
// • children 要处理的 children
// • nameSoFar 父级 key，会一层一层拼接传递，用 : 分隔
// • callback 如果当前层级是可渲染节点，undefined、boolean 会变成 null，string、number、?typeof 是 REACT_ELEMENT_TYPE 或者 REACT_PORTAL_TYPE，会调用 mapSingleChildIntoContext 处理
// • traverseContext 对象池中拿出来的一个对象
function traverseAllChildrenImpl(
  children,
  nameSoFar,
  callback,
  traverseContext,
) {
  const type = typeof children;

  // children类型为undefined或boolean，则children为null
  if (type === 'undefined' || type === 'boolean') {
    // All of the above are perceived as null.
    children = null;
  }

  let invokeCallback = false;
// children为null/string/number/REACT_ELEMENT_TYPE obj/REACT_PORTAL_TYPE obj，直接触发回调
  if (children === null) {
    invokeCallback = true; 
  } else {
    switch (type) {
      case 'string':
      case 'number':
        invokeCallback = true;
        break;
      case 'object':
        switch (children.$$typeof) {
          case REACT_ELEMENT_TYPE:
          case REACT_PORTAL_TYPE:
            invokeCallback = true;
        }
    }
  }

  // 触发回调返回1
  if (invokeCallback) {
    callback(
      traverseContext,
      children,
      // If it's the only child, treat the name as if it was wrapped in an array
      // so that it's consistent if the number of children grows.
      // 真正的key值
      nameSoFar === '' ? SEPARATOR + getComponentKey(children, 0) : nameSoFar,
    );
    return 1;
  }

  let child;
  let nextName;
  let subtreeCount = 0; // Count of children found in the current subtree.
  // const SEPARATOR = '.';
  // const SUBSEPARATOR = ':';
  const nextNamePrefix =
    nameSoFar === '' ? SEPARATOR : nameSoFar + SUBSEPARATOR;

  // children是数组，对children中每个元素调用traverseAllChildrenImpl
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      child = children[i];
      // 当前子节点的key值，包括nextNamePrefix和组件挂载的key值。
      nextName = nextNamePrefix + getComponentKey(child, i);
      // 子节点的数量：递归
      subtreeCount += traverseAllChildrenImpl(
        child,
        nextName,
        callback,
        traverseContext,
      );
    }
  } else {
    // 如果是对象，获取对象的迭代器，迭代对象调用traverseAllChildrenImpl
    // 不是数组的话，就看看 children 是否可以支持迭代
    const iteratorFn = getIteratorFn(children);
    if (typeof iteratorFn === 'function') {
      if (__DEV__) {
        // Warn about using Maps as children
        if (iteratorFn === children.entries) {
          warning(
            didWarnAboutMaps,
            'Using Maps as children is unsupported and will likely yield ' +
              'unexpected results. Convert it to a sequence/iterable of keyed ' +
              'ReactElements instead.',
          );
          didWarnAboutMaps = true;
        }
      }

      // 获取children的迭代器
      const iterator = iteratorFn.call(children);
      let step;
      let ii = 0;
      while (!(step = iterator.next()).done) {
        child = step.value;
        nextName = nextNamePrefix + getComponentKey(child, ii++);
        subtreeCount += traverseAllChildrenImpl(
          child,
          nextName,
          callback,
          traverseContext,
        );
      }
    } else if (type === 'object') {
      let addendum = '';
      if (__DEV__) {
        addendum =
          ' If you meant to render a collection of children, use an array ' +
          'instead.' +
          ReactDebugCurrentFrame.getStackAddendum();
      }
      const childrenString = '' + children;
      invariant(
        false,
        'Objects are not valid as a React child (found: %s).%s',
        childrenString === '[object Object]'
          ? 'object with keys {' + Object.keys(children).join(', ') + '}'
          : childrenString,
        addendum,
      );
    }
  }

  // 返回子树的节点数
  return subtreeCount;
}

/**
 * Traverses children that are typically specified as `props.children`, but
 * might also be specified through attributes:
 *
 * - `traverseAllChildren(this.props.children, ...)`
 * - `traverseAllChildren(this.props.leftPanelChildren, ...)`
 *
 * The `traverseContext` is an optional argument that is passed through the
 * entire traversal. It can be used to store accumulations or anything else that
 * the callback might find relevant.
 *
 * @param {?*} children Children tree object.
 * @param {!function} callback To invoke upon traversing each child.
 * @param {?*} traverseContext Context for traversal.
 * @return {!number} The number of children in this subtree.返回子树中节点的数量
 */
// traverseAllChildren(children, mapSingleChildIntoContext, traverseContext);
function traverseAllChildren(children, callback, traverseContext) {
  if (children == null) {
    return 0;
  }

  return traverseAllChildrenImpl(children, '', callback, traverseContext);
}

/**
 * Generate a key string that identifies a component within a set.
 *
 * @param {*} component A component that could contain a manual key.
 * @param {number} index Index that is used if a manual key is not provided.
 * @return {string}
 */
function getComponentKey(component, index) {
  // Do some typechecking here since we call this blindly. We want to ensure
  // that we don't block potential future ES APIs.
  if (
    typeof component === 'object' &&
    component !== null &&
    component.key != null
  ) {
    // 如果显式给了key值，则返回安处理过的key，否则返回index的str值
    // Explicit key
    return escape(component.key);
  }
  // Implicit key determined by the index in the set
  return index.toString(36);
}

// 迭代时的回调函数
// callback(traverseContext,children,nameSoFar === '' ? SEPARATOR + getComponentKey(children, 0) : nameSoFar,);
// func： forEachFunc用户传递的回调
function forEachSingleChild(bookKeeping, child, name) {
  const {func, context} = bookKeeping;
  func.call(context, child, bookKeeping.count++);
}

/**
 * Iterates through children that are typically specified as `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenforeach
 *
 * The provided forEachFunc(child, index) will be called for each
 * leaf child.
 *
 * @param {?*} children Children tree container.
 * @param {function(*, int)} forEachFunc
 * @param {*} forEachContext Context for forEachContext.
 */
function forEachChildren(children, forEachFunc, forEachContext) {
  if (children == null) {
    return children;
  }
  // 获取遍历对象缓存池中的资源
  // mapResult,
  // keyPrefix,
  // mapFunction,
  // mapContext,
  const traverseContext = getPooledTraverseContext(
    null, // 只需要遍历，不需要返回结果，所以传null
    null,
    forEachFunc, // 用户传递的回调
    forEachContext,
  );
  // 遍历子节点
  traverseAllChildren(children, forEachSingleChild, traverseContext);
  // 释放缓存池中的资源
  releaseTraverseContext(traverseContext);
}
/**
 * @desc 将 child 推入 traverseContext 的 result 数组中，child 如果是 ReactElement，则更改 key 了再推入。
 * @param {*} bookKeeping 就是我们从对象池子里取出来的东西，`traverseContext`
 * @param {*} child 
 * @param {*} childKey 
 */
function mapSingleChildIntoContext(bookKeeping, child, childKey) {
  const {result, keyPrefix, func, context} = bookKeeping;
  // func 就是我们在 React.Children.map(this.props.children, c => c)
  // 中传入的第二个函数参数
  let mappedChild = func.call(context, child, bookKeeping.count++);
  // 判断函数返回值是否为数组
  // 因为可能会出现这种情况
  // React.Children.map(this.props.children, c => [c, c])
  // 对于 c => [c, c] 这种情况来说，每个子元素都会被返回出去两次
  // 也就是说假如有 2 个子元素 c1 c2，那么通过调用 React.Children.map(this.props.children, c => [c, c]) 后
  // 返回的应该是 4 个子元素，c1 c1 c2 c2

  if (Array.isArray(mappedChild)) {
    // 是数组的话就回到最先调用的函数中
    // 然后回到之前 traverseAllChildrenImpl 摊平数组的问题
    // 假如 c => [[c, c]]，当执行这个函数时，返回值应该是 [c, c]
    // 然后 [c, c] 会被当成 children 传入
    // traverseAllChildrenImpl 内部逻辑判断是数组又会重新递归执行
    // 所以说即使你的函数是 c => [[[[c, c]]]]
    // 最后也会被递归摊平到 [c, c, c, c]

    mapIntoWithKeyPrefixInternal(mappedChild, result, childKey, c => c);
  } else if (mappedChild != null) {
    // 不是数组且返回值不为空，判断返回值是否为有效的 Element
    // 是的话就把这个元素 clone 一遍并且替换掉 key

    if (isValidElement(mappedChild)) {
      mappedChild = cloneAndReplaceKey(
        mappedChild,
        // Keep both the (mapped) and old keys if they differ, just as
        // traverseAllChildren used to do for objects as children
        keyPrefix +
          (mappedChild.key && (!child || child.key !== mappedChild.key)
            ? escapeUserProvidedKey(mappedChild.key) + '/'
            : '') +
          childKey,
      );
    }
    // 将map的结果装进result。
    result.push(mappedChild);
  }
}


// mapIntoWithKeyPrefixInternal(children, result, null, func, context);
/**
 * 
 * @param {*} children 
 * @param {*} array 结果数组
 * @param {*} prefix map handler
 * @param {*} func 
 * @param {*} context this的上下文环境
 */
function mapIntoWithKeyPrefixInternal(children, array, prefix, func, context) {
  let escapedPrefix = '';
  if (prefix != null) {
    escapedPrefix = escapeUserProvidedKey(prefix) + '/';
  }
  // 获得一个traverseContext
  // getPooledTraverseContext 和 releaseTraverseContext 是配套的函数
  // 用处其实很简单，就是维护一个大小为 10 的对象重用池
  // 每次从这个池子里取一个对象去赋值，用完了就将对象上的属性置空然后丢回池子
  // 维护这个池子的用意就是提高性能，毕竟频繁创建销毁一个有很多属性的对象消耗性能
  const traverseContext = getPooledTraverseContext(
    array,
    escapedPrefix,
    func,
    context,
  );
  // 遍历节点
  traverseAllChildren(children, mapSingleChildIntoContext, traverseContext);
  releaseTraverseContext(traverseContext);
}

/**
 * @description 实现children的map方法
 * Maps children that are typically specified as `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenmap
 *
 * The provided mapFunction(child, key, index) will be called for each
 * leaf child.
 *
 * @param {?*} children Children tree container.
 * @param {function(*, int)} func The map function.
 * @param {*} context Context for mapFunction.
 * @return {object} Object containing the ordered map of results.
 */
function mapChildren(children, func, context) {
  // children为空则返回null
  if (children == null) {
    return children;
  }
  // map的结果通过result返回
  const result = [];
  mapIntoWithKeyPrefixInternal(children, result, null, func, context);
  return result;
}

/**
 * Count the number of children that are typically specified as
 * `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrencount
 *
 * @param {?*} children Children tree container.
 * @return {number} The number of children.
 */
function countChildren(children) {
  return traverseAllChildren(children, () => null, null);
}

/**
 * Flatten a children object (typically specified as `props.children`) and
 * return an array with appropriately re-keyed children.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrentoarray
 */
function toArray(children) {
  const result = [];
  mapIntoWithKeyPrefixInternal(children, result, null, child => child);
  return result;
}

/**
 * Returns the first child in a collection of children and verifies that there
 * is only one child in the collection.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenonly
 *
 * The current implementation of this function assumes that a single child gets
 * passed without a wrapper, but the purpose of this helper function is to
 * abstract away the particular structure of children.
 *
 * @param {?object} children Child collection structure.
 * @return {ReactElement} The first and only `ReactElement` contained in the
 * structure.
 */
function onlyChild(children) {
  invariant(
    isValidElement(children),
    'React.Children.only expected to receive a single React element child.',
  );
  return children;
}

export {
  forEachChildren as forEach,
  mapChildren as map,
  countChildren as count,
  onlyChild as only,
  toArray,
};
