# SCHEM Workbench

Alfalaval 内部使用的本地网页应用，用于简单工况热交换器标准化选型查找、项目资料查找和数据库维护。

## 启动方式

推荐双击 `start.bat`，或在该目录执行：

```powershell
python server.py
```

然后浏览器会打开 `http://127.0.0.1:8000/index.html`。

也可以直接双击 `index.html`，但部分浏览器在 `file://` 下可能不允许自动读写本地独立数据文件，此时会退回到浏览器内部存储，并可通过界面手动导入/导出数据。

## 数据保存

- 应用使用本地 Excel 文件作为主数据文件，例如 `SCHEM_Data.xlsx`。
- 在首页顶部或左侧底部点击“Data file / 数据文件”，可以新建或打开这个 Excel 文件。
- 之后所有编辑会自动写入该本地文件，并同时保存在浏览器缓存中作为兜底。
- 刷新、关闭、重启电脑后数据不会丢失。
- 如果浏览器要求重新授权本地文件，点击顶部“Data file / 数据文件”即可重新授权。
- 数据库编辑器里还支持从你现有的 `.xlsx` 文件中导入 SCHEM B / SCHEM A 数据。

## 模块

1. Overview：各模块摘要和最近编辑。
2. SCHEM Basic Search：物料、系列、工况参数搜索和温度边界搜索。
3. SCHEM Advance Search：项目文件、文件夹、二次命名和描述搜索。
4. Database Editor：SCHEM B / SCHEM A 数据维护，支持 Excel 导入和导出。
5. Language：简体中文 / English 切换。
6. Feedback：开发者联系邮箱。

## 使用提示

- Basic Search 的工况参数搜索按数值匹配，并保留约 0.5% 的容差。
- 温度边界搜索将输入的两个温度作为范围，较小值为下限，较大值为上限。
- 流量搜索会同时匹配流量单位。
