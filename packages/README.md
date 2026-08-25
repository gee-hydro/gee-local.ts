# packages

本地 GEE JS 包根目录（默认）。**require 须带 `.js`**。
`ee-auth/` 是独立 npm 包，不是 GEE JS 包。

```js
require('region.js')
require('hydro/mask.js')
require('users/kongdd/utils:math.js')  // → packages/users/kongdd/utils/math.js
```

指定路径：

```bash
ee add user/pkg                            # clone → packages/users/user/pkg
ee config set packages ./packages          # 项目 .gee-helper.json
ee config set packages ~/gee-js --user     # 用户级
ee run --package-path ./other_pkgs s.js
export GEE_JS_PATH=/more/pkgs
```
