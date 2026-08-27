# -*- coding: utf-8 -*-
"""网文工坊 - 本地 AI 网文章节生成器（零依赖，仅用 Python 标准库）"""
import json
import os
import socket
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(ROOT, 'public')
DATA_DIR = os.path.join(ROOT, 'data')
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')
PORT = int(os.environ.get('NOVEL_STUDIO_PORT', '8787'))

DEFAULT_CONFIG = {
    'baseUrl': 'https://api.openai.com/v1',
    'apiKey': '',
    'model': 'gpt-4o-mini',
    'temperature': 0.8,
    'maxTokens': 3000,
    'targetWords': 2000,
    'style': '节奏明快、画面感强、对话生动'
}

EMPTY_STORES = {
    'worldbook.json': {'items': []},
    'characters.json': {'items': []},
    'plot.json': {'mainline': '', 'chapters': []},
    'chapters.json': {'items': []},
}

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
}


def ensure_data():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(CONFIG_FILE):
        write_json(CONFIG_FILE, DEFAULT_CONFIG)
    for name in EMPTY_STORES:
        p = os.path.join(DATA_DIR, name)
        if not os.path.exists(p):
            write_json(p, EMPTY_STORES[name])


def read_json(path, fallback):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return json.loads(json.dumps(fallback))


def write_json(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


# ---------------- AI 提示词 ----------------

def _no(x):
    try:
        return float(str(x).strip().rstrip('章　 '))
    except Exception:
        return 0


def build_generate_messages(cfg, ctx):
    style = cfg.get('style', '')
    system = (
        '你是一名资深中文网文作家。请根据给定的世界观、角色设定、故事主线与本章大纲，'
        '创作符合要求的小说章节正文。\n'
        '写作要求：\n'
        f'1. 文风：{style}。\n'
        '2. 只输出小说正文本身，不要输出任何解释、标题、大纲或“以下是章节”之类的话。\n'
        '3. 对话要贴合角色性格与说话风格，注意节奏和画面感。\n'
        '4. 严格按本章大纲推进情节，细节可以自然发挥，但不要偏离大纲。\n'
        '5. 章节结尾留一个钩子或悬念，方便读者追更。'
    )
    parts = []

    wb = [e for e in ctx.get('worldbook', []) if e.get('active', True)]
    if wb:
        lines = []
        for e in wb:
            title = e.get('title') or e.get('keyword')
            lines.append('■ ' + str(title) + '\n' + str(e.get('content', '')))
        parts.append('【世界书 / 世界观设定】\n' + '\n\n'.join(lines))

    chars = ctx.get('characters', [])
    if chars:
        lines = []
        for c in chars:
            lines.append(
                '■ ' + str(c.get('name', '')) + '\n'
                '身份背景：' + str(c.get('profile', '')) + '\n'
                '性格：' + str(c.get('personality', '')) + '\n'
                '说话风格：' + str(c.get('dialogueStyle', '')) + '\n'
                + (('示例对话：\n' + str(c.get('exampleDialogue', ''))) if c.get('exampleDialogue') else '')
            )
        parts.append('【主要角色】\n' + '\n\n'.join(lines))

    if ctx.get('mainline'):
        parts.append('【故事主线 / 剧情走向】\n' + str(ctx['mainline']))

    out = ctx.get('outline', {})
    outline_text = '第' + str(out.get('no', '')) + '章《' + str(out.get('title', '')) + '》\n'
    outline_text += '章节概要：' + str(out.get('summary', '')) + '\n'
    if out.get('keyPoints'):
        outline_text += '关键情节：\n- ' + '\n- '.join(
            [x.strip() for x in str(out['keyPoints']).split('\n') if x.strip()])
    if out.get('notes'):
        outline_text += '\n写作备注：' + str(out['notes'])
    parts.append('【本章大纲】\n' + outline_text)

    # 前情提要：注入上一章结尾，保证前后连贯
    try:
        chs = read_json(os.path.join(DATA_DIR, 'chapters.json'), EMPTY_STORES['chapters.json']).get('items', []) or []
        cur = _no(out.get('no'))
        prevs = sorted([c for c in chs if _no(c.get('no')) and _no(c.get('no')) < cur], key=lambda c: _no(c.get('no')))
        if prevs:
            ptext = str(prevs[-1].get('content', '')).strip()
            if ptext:
                parts.append('【前文结尾（上一章）】\n……' + ptext[-500:])
    except Exception:
        pass

    parts.append('请创作本章正文，目标字数约 ' + str(cfg.get('targetWords', 2000)) + ' 字。')
    return [
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': '\n\n'.join(parts)}
    ]


def build_polish_messages(cfg, ctx):
    inject = ''
    try:
        wb = read_json(os.path.join(DATA_DIR, 'worldbook.json'), EMPTY_STORES['worldbook.json']).get('items', []) or []
        chars = read_json(os.path.join(DATA_DIR, 'characters.json'), EMPTY_STORES['characters.json']).get('items', []) or []
        plot = read_json(os.path.join(DATA_DIR, 'plot.json'), EMPTY_STORES['plot.json'])
        lines = []
        if wb:
            lines.append('【世界观】\n' + '\n'.join('■ ' + str(e.get('title', e.get('keyword', ''))) + '：' + str(e.get('content', '')) for e in wb if e.get('active', True)))
        if chars:
            lines.append('【角色】\n' + '\n'.join('■ ' + str(c.get('name', '')) + '：' + str(c.get('personality', '')) + '；说话风格：' + str(c.get('dialogueStyle', '')) for c in chars))
        if plot.get('mainline'):
            lines.append('【主线】\n' + str(plot['mainline']))
        if lines:
            inject = '<背景参考，勿复述，仅用于保持一致>\n' + '\n\n'.join(lines) + '\n\n'
    except Exception:
        pass

    if ctx.get('task') == 'continue':
        system = '你是一名资深中文网文作家，擅长自然续写。'
        user = (
            inject +
            '以下是小说上一段内容：\n\n' + str(ctx.get('text', '')) +
            '\n\n请自然地续写下一段，保持文风、视角、人物与节奏一致，不要重复已有内容，'
            '只输出续写部分。'
        )
    else:
        system = '你是一名资深中文网文编辑。'
        user = (
            inject +
            '以下是小说章节草稿：\n\n' + str(ctx.get('text', '')) +
            '\n\n润色指令：' + str(ctx.get('instruction', '')) +
            '\n要求：保留情节、人物与伏笔不变，提升文笔、节奏与可读性；'
            '输出润色后的完整正文，不要任何解释。'
        )
    return [
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': user}
    ]


def ai_headers(cfg):
    return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + str(cfg.get('apiKey', '')),
        'Accept-Encoding': 'identity',
    }


def _post_ai(cfg, payload):
    url = str(cfg['baseUrl']).rstrip('/') + '/chat/completions'
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=ai_headers(cfg))
    return urllib.request.urlopen(req, timeout=300)


def call_ai(cfg, messages):
    """Non-streaming call, with a small retry on transient failures."""
    payload = {
        'model': cfg.get('model', 'gpt-4o-mini'),
        'messages': messages,
        'temperature': float(cfg.get('temperature', 0.8)),
        'max_tokens': int(cfg.get('maxTokens', 3000)),
    }
    last = None
    for attempt in range(3):
        try:
            with _post_ai(cfg, payload) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            return data['choices'][0]['message']['content']
        except urllib.error.HTTPError as e:
            last_error = e.read().decode('utf-8', 'ignore')[:400]
            if e.code < 500 and e.code != 429:
                raise
            last = ('HTTP %s: %s' % (e.code, last_error))
        except Exception as e:  # connection etc.
            last = str(e)
            if attempt == 2:
                raise
    raise RuntimeError(last)


def stream_ai(cfg, messages):
    """Streaming call — yields text deltas (OpenAI-compatible SSE)."""
    payload = {
        'model': cfg.get('model', 'gpt-4o-mini'),
        'messages': messages,
        'temperature': float(cfg.get('temperature', 0.8)),
        'max_tokens': int(cfg.get('maxTokens', 3000)),
        'stream': True,
    }
    resp = _post_ai(cfg, payload)
    try:
        for raw in resp:
            line = raw.decode('utf-8', 'ignore')
            if not line.startswith('data:'):
                continue
            data = line[5:].strip()
            if data == '[DONE]':
                break
            try:
                js = json.loads(data)
                delta = js.get('choices', [{}])[0].get('delta', {}).get('content', '')
                if delta:
                    yield delta
            except Exception:
                pass
    finally:
        resp.close()


def build_messages_for_task(cfg, task, body):
    if task == 'test':
        return [{'role': 'user', 'content': '请只回复四个字：连接成功'}], 'test'
    if task == 'generate':
        return build_generate_messages(cfg, body), 'generate'
    if task in ('polish', 'continue'):
        return build_polish_messages(cfg, body), task
    return None, None


def handle_ai(body):
    cfg = read_json(CONFIG_FILE, DEFAULT_CONFIG)
    task = body.get('task', 'generate')
    messages, _ = build_messages_for_task(cfg, task, body)
    if messages is None:
        return {'ok': False, 'error': '未知任务类型'}
    try:
        return {'ok': True, 'text': call_ai(cfg, messages)}
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'ignore')[:400]
        return {'ok': False, 'error': 'AI 接口返回 ' + str(e.code) + '：' + detail}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def port_in_use(port):
    try:
        s = socket.create_connection(('127.0.0.1', port), timeout=1)
        s.close()
        return True
    except OSError:
        return False


# --- simple security (optional) ---
# Set env NOVEL_STUDIO_TOKEN to require an admin token for /api/* endpoints.
# /api/ai is rate-limited per IP (per minute) and capped per run to guard spend.
AI_RATE_MIN = 8
AI_DAILY_MAX = 200
AI_BUCKET = {}
AI_DAILY = [0]


# ---------------- HTTP ----------------

class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        try:
            with open(os.path.join(ROOT, 'server.log'), 'a', encoding='utf-8') as f:
                f.write('[novel-studio] %s\n' % (fmt % args))
        except Exception:
            pass

    def _send(self, code, data, ctype='application/json; charset=utf-8'):
        if isinstance(data, str):
            data = data.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False))

    def _authorized(self):
        """If NOVEL_STUDIO_TOKEN is set, require X-Admin-Token to match."""
        tok = os.environ.get('NOVEL_STUDIO_TOKEN', '').strip()
        if not tok:
            return True
        given = self.headers.get('X-Admin-Token', '')
        return given == tok

    def _ai_allowed(self):
        """Rate limit /api/ai: per-IP window + per-run cap."""
        import time
        now = time.time()
        key = self.client_address[0]
        bucket = AI_BUCKET.setdefault(key, [])
        bucket[:] = [t for t in bucket if t > now - 60]
        if len(bucket) >= AI_RATE_MIN:
            return False, '请求过于频繁，请稍后再试'
        if AI_DAILY[0] >= AI_DAILY_MAX:
            return False, '今日 AI 配额已用完'
        bucket.append(now)
        AI_DAILY[0] += 1
        return True, None

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/config':
            if not self._authorized():
                self._send_json({'ok': False, 'error': '未授权'}, 401)
                return
            self._send_json(read_json(CONFIG_FILE, DEFAULT_CONFIG))
            return
        if path == '/api/store':
            if not self._authorized():
                self._send_json({'ok': False, 'error': '未授权'}, 401)
                return
            out = {}
            for name in EMPTY_STORES:
                out[name] = read_json(os.path.join(DATA_DIR, name), EMPTY_STORES[name])
            self._send_json(out)
            return
        self._serve_static(path)

    def _serve_static(self, path):
        if path == '/':
            path = '/index.html'
        rel = os.path.normpath(path.lstrip('/'))
        if rel.startswith('..') or os.path.isabs(rel):
            self._send(403, 'Forbidden', 'text/plain; charset=utf-8')
            return
        fp = os.path.join(PUBLIC_DIR, rel)
        if not os.path.isfile(fp):
            self._send(404, 'Not Found', 'text/plain; charset=utf-8')
            return
        ext = os.path.splitext(fp)[1].lower()
        with open(fp, 'rb') as f:
            self._send(200, f.read(), MIME.get(ext, 'application/octet-stream'))

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode('utf-8')) if raw else {}
        except Exception:
            self._send_json({'ok': False, 'error': '请求体不是合法 JSON'}, 400)
            return
        path = self.path.split('?', 1)[0]
        if path == '/api/config':
            if not self._authorized():
                self._send_json({'ok': False, 'error': '未授权'}, 401)
                return
            merged = read_json(CONFIG_FILE, DEFAULT_CONFIG)
            merged.update(body)
            write_json(CONFIG_FILE, merged)
            self._send_json({'ok': True})
            return
        if path == '/api/store':
            if not self._authorized():
                self._send_json({'ok': False, 'error': '未授权'}, 401)
                return
            fname = body.get('file', '')
            if fname not in EMPTY_STORES:
                self._send_json({'ok': False, 'error': '不允许写入该文件'}, 400)
                return
            write_json(os.path.join(DATA_DIR, fname), body.get('data', EMPTY_STORES[fname]))
            self._send_json({'ok': True})
            return
        if path == '/api/ai':
            if not self._authorized():
                self._send_json({'ok': False, 'error': '未授权'}, 401)
                return
            ok, err = self._ai_allowed()
            if not ok:
                self._send_json({'ok': False, 'error': err}, 429)
                return
            if body.get('stream'):
                self._stream_ai(body)
                return
            self._send_json(handle_ai(body))
            return
        self._send_json({'ok': False, 'error': '未知接口'}, 404)

    def _stream_ai(self, body):
        cfg = read_json(CONFIG_FILE, DEFAULT_CONFIG)
        task = body.get('task', 'generate')
        try:
            messages, _ = build_messages_for_task(cfg, task, body)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 400)
            return
        if not messages:
            self._send_json({'ok': False, 'error': '未知任务类型'}, 400)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'close')
        self.end_headers()
        try:
            for delta in stream_ai(cfg, messages):
                self.wfile.write(('data: ' + json.dumps({'ok': True, 'delta': delta}, ensure_ascii=False) + '\n\n').encode('utf-8'))
                self.wfile.flush()
            self.wfile.write(b'data: {"ok":true,"done":true}\n\n')
            self.wfile.flush()
        except BrokenPipeError:
            pass
        except Exception as e:
            try:
                self.wfile.write(('data: ' + json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False) + '\n\n').encode('utf-8'))
                self.wfile.flush()
            except Exception:
                pass


def main():
    ensure_data()
    if port_in_use(PORT):
        print('端口 %d 已被占用：可能已有网文工坊实例在运行。' % PORT)
        print('如果浏览器能打开 http://127.0.0.1:%d ，直接使用即可。' % PORT)
        print('如果打不开，请先关闭旧的 python 窗口，再重新启动。')
        sys.exit(1)
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        print('端口 %d 被占用，可用环境变量 NOVEL_STUDIO_PORT 换一个端口。' % PORT)
        sys.exit(1)
    print('网文工坊已启动：http://127.0.0.1:%d' % PORT)
    print('按 Ctrl+C 停止')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


def selftest():
    import threading
    ensure_data()
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = 'http://127.0.0.1:%d' % port
    checks = []
    try:
        with urllib.request.urlopen(base + '/api/store', timeout=5) as r:
            data = json.loads(r.read().decode('utf-8'))
        checks.append(('store', set(data.keys()) == set(EMPTY_STORES.keys())))

        payload = json.dumps({
            'file': 'worldbook.json',
            'data': {'items': [{'id': 'x', 'keyword': '测试', 'title': 't', 'content': 'c', 'active': True}]}
        }).encode('utf-8')
        req = urllib.request.Request(base + '/api/store', data=payload,
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=5) as r:
            checks.append(('post', json.loads(r.read().decode('utf-8')).get('ok') is True))

        with urllib.request.urlopen(base + '/', timeout=5) as r:
            html = r.read().decode('utf-8')
        checks.append(('index', '网文工坊' in html))

        req2 = urllib.request.Request(base + '/api/store',
                                      data=json.dumps({'file': 'worldbook.json', 'data': {'items': []}}).encode('utf-8'),
                                      headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req2, timeout=5).read()
        checks.append(('restore', True))
    finally:
        server.shutdown()
        server.server_close()
    ok = all(passed for _, passed in checks)
    for name, passed in checks:
        print(('PASS' if passed else 'FAIL') + ' ' + name)
    print('SELFTEST ' + ('OK' if ok else 'FAILED'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest()
    else:
        main()
