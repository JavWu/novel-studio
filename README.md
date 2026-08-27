# 网文工坊 · AI 章节生成器

一款本地运行的网文章节生成工具。你负责提供**世界书（世界观）、主要角色、剧情走向、章节大纲**，AI 负责**生成并润色**每一章正文。

## 功能

- **世界书**：按关键词维护世界观条目，生成时自动注入提示词
- **主要角色**：角色卡（背景 / 性格 / 说话风格 / 示例对话），保证对话"像"这个人
- **剧情大纲**：整本书主线 + 分章大纲（概要、关键情节、写作备注）
- **章节写作**：选大纲 → AI 生成 → 手动修改 → 一键润色（提升文笔 / 扩写 / 精简 / 重写对话 / 续写）→ 保存
- **批量生成**：按大纲顺序一次生成全部章节并自动保存，中途失败会停下，已生成的不丢失
- **导出**：全部章节一键导出 Markdown
- **AI 设置**：兼容所有 OpenAI 格式接口，测试连接功能

## 运行

环境：Windows + Python 3（无需安装任何第三方库）。

推荐方式：双击 `启动网文工坊.bat`，然后浏览器打开 http://127.0.0.1:8787。

或者用命令行：

```bat
cd outputs\novel-studio
python server.py
```

浏览器打开：http://127.0.0.1:8787

停止：在命令行按 Ctrl+C。如果端口被占用，先设置环境变量再启动：

```bat
set NOVEL_STUDIO_PORT=9000
python server.py
```

## 常见问题

**页面一直转圈打不开？**

1. 确认只有一个服务在运行：命令行执行 `netstat -ano | findstr 8787`，应只有一行 LISTENING。
2. 如果之前开过多个窗口，先全部关掉，再双击 `启动网文工坊.bat`。
3. 仍打不开：检查 360 / 火绒 / Windows Defender 防火墙是否拦截了 Python 的联网或端口监听，放行后再试。
4. 用 Chrome / Edge 访问，不要用某些应用内置浏览器访问本机地址。
5. 双击 bat 如果提示“端口已被占用”，说明服务已经在运行，直接打开浏览器即可。

## 配置 AI 接口（打开页面后点「AI 设置」）

| 服务 | baseUrl | 示例模型 |
|---|---|---|
| OpenAI | https://api.openai.com/v1 | gpt-4o-mini |
| DeepSeek | https://api.deepseek.com/v1 | deepseek-chat |
| Kimi（月之暗面） | https://api.moonshot.cn/v1 | moonshot-v1-32k |
| 通义千问 | https://dashscope.aliyuncs.com/compatible-mode/v1 | qwen-plus |
| 豆包（火山方舟） | 你的方舟 endpoint | doubao-... |
| 本地 Ollama | http://127.0.0.1:11434/v1 | qwen2.5:14b（key 随便填） |

## 数据存放

所有内容都保存在本机 `data/` 文件夹：

- `worldbook.json`：世界书
- `characters.json`：角色
- `plot.json`：主线与章节大纲
- `chapters.json`：已生成的章节正文
- `config.json`：AI 接口配置（含 API Key，仅存本机）

备份：把整个 `data/` 文件夹复制走即可。

## 注意

- 生成内容是草稿，投稿前请自行对照各平台的 AI 内容政策。
- API Key 只保存在本地，不要把这个文件夹分享给别人。
