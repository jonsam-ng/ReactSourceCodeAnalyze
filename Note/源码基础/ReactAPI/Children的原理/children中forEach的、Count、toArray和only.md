# children中forEach的、Count、toArray和only
## forEach
forEach 是以`forEachChildren`导出的，功能类似于数组的forEach。
```js
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
```
在forEachChildren函数中，基本和map类似，参看[[map原理解析]]。唯一的不同就是不需要返回结果。
对于扁平化后的child，由forEachSingleChild处理。

## Count
count只是在遍历children时返回了subtreeCount。

## toArray
```js
function toArray(children) {
  const result = [];
  mapIntoWithKeyPrefixInternal(children, result, null, child => child);
  return result;
}
```
这里和map差不多，只是将map传的func变成了`child => child`。和map一样返回数组。

## only
Returns the first child in a collection of children and verifies that there is **only one** child in the collection.
```js
function onlyChild(children) {
  invariant(
    isValidElement(children),
    'React.Children.only expected to receive a single React element child.',
  );
  return children;
}
```

## 参考资料
> 参 考：
> - [React Children 详解](https://juejin.im/post/6844903910285508621)