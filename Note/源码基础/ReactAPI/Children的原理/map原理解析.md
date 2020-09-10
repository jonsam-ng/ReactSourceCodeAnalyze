# children.map()
![[map_func.png]]
map是通过mapChildren()实现的。
```js
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
```
mapIntoWithKeyPrefixInternal()中：
1. getPooledTraverseContext()维护一个遍历对象的pool，这样做是因为：map需要对children的节点进行遍历操作，甚至是递归，这样会很消耗性能，因此，设置对象池可以提高性能，不必频繁的创建和销毁节点对象。
2. 核心函数是traverseAllChildren()，其中mapSingleChildIntoContext()为回调函数，将扁平化的child进行callback的调用，并装进result数组中。traverseContext为取到的池子中的对象。
```js
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
```
- getPooledTraverseContext()的原理：
```js
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
```

- mapSingleChildIntoContext()的原理：
```js
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
```
其中：
> - 扁平化处理后的child会被作为参数传入map中的callback函数中。
> - mappedChild会被替换key值放到result中。
> - 如果mappedChild仍然是数组，会重新mapIntoWithKeyPrefixInternal进行扁平化处理。

3. traverseAllChildren()实际上调用的是traverseAllChildrenImpl()来实现。主要功能是将children节点扁平化。
```js
function traverseAllChildren(children, callback, traverseContext) {
  if (children == null) {
    return 0;
  }

  return traverseAllChildrenImpl(children, '', callback, traverseContext);
}
```
traverseAllChildrenImpl() 的原理：
```js
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
```
其中，注意以下几点：
1. 如果children是可渲染对象，如转换为`null`的`undefined`和`boolean`、`string`、`number`、`$$typeof`为`REACT_ELEMENT_TYPE`和`REACT_PORTAL_TYPE`的`object`,则可以直接调用callback，注意此处的callback是mapSingleChildIntoContext。
2. 如果children是数组，应该先调用traverseAllChildrenImpl()对数组做扁平化处理（递归调用），直到变化成可渲染对象。
3. 或者是其他可迭代对象（包括object），则使用迭代器迭代并递归进行扁平化。
4. 扁平化后最终会成为可渲染对象，回到1。
key的来源：
1. traverseAllChildrenImpl()中有如下代码：
```js
// const SEPARATOR = '.';
// const SUBSEPARATOR = ':';
const nextNamePrefix =
	nameSoFar === '' ? SEPARATOR : nameSoFar + SUBSEPARATOR;
```
对数组的处理中：
```js
nextName = nextNamePrefix + getComponentKey(child, i);
```
其中getComponentKey():
```js
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
```
nextName由两部分组成，nextNamePrefix和getComponentKey；
- nextNamePrefix：如果显式给了key值，先判断当前的key是否为空串，即`nameSoFar === ''`，如果是空串就加上`.`，否则加`:`；
- getComponentKey：如果用户显式给了key，则返回key，否则返回str index，注意要连接上`$`。
```js
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
 ```
- escape()对可以做了处理，匹配等号和冒号，替换为=0或:2，加上$返回。
- key值生成后的形式：`.[key|idx]:[key|idx]:[key|idx]...`

> 参 考：
> - [React Children 详解](https://juejin.im/post/6844903910285508621)