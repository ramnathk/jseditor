// Fixed Python program executed by the game's own interpreter through window.renpy_exec.
// Rules (RENPY_MODE_REQUIREMENTS.md, RT-02/RT-03/RT-07):
//  * ASCII only: renpy-pre.js base64-encodes the source with btoa(), which throws above U+00FF
//    and would leave the game's command queue permanently jammed.
//  * Exactly one placeholder, __GVE_ARGS__, replaced with base64(UTF-8(JSON)) by the engine.
//    User data never reaches the interpreter as source text.
//  * The script runs with globals = the Ren'Py store and locals = a throwaway dict, and the store
//    shadows dict/list/set/object with Revertable versions. So all logic lives inside one function
//    (nested closures only) and builtins come from `import builtins as B`.
//  * Nothing here calls getters, __getattr__, __iter__ or __eq__ of game classes.
export const RENPY_PY = String.raw`
def _gve_main(_arg):
    import builtins as B
    import sys, types, time, json, base64, re
    MISSING = B.object()
    G = globals()
    SAFE = 9007199254740991
    SLICE = 0.15
    TOTAL = 2.5
    MAXCHECKS = 150000
    MAXQUEUE = 20000
    MAXRESULTS = 10000
    MAXDEPTH = 8
    NUM = re.compile(r'^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$')
    INT = re.compile(r'^[-+]?\d{1,16}$')
    try:
        args = json.loads(base64.b64decode(_arg).decode('utf-8'))
        op = args.get('op')
        dl = args.get('deadline')
        if B.type(dl) in (B.int, B.float) and time.time() * 1000.0 > dl:
            return {'v': 1, 'ok': False, 'expired': True}

        def fail(message):
            return {'v': 1, 'ok': False, 'error': message}

        def trusted(t):
            if t is B.dict or t is B.list:
                return True
            try:
                return t.__module__ == 'renpy.revertable' and (B.issubclass(t, B.dict) or B.issubclass(t, B.list))
            except BaseException:
                return False

        def is_obj(v):
            t = B.type(v)
            try:
                if B.type(t) is not B.type:
                    return False
                mod = t.__module__
                if B.type(mod) is not B.str:
                    return False
                ok = mod == 'store' or mod.startswith('store.') or (mod == 'renpy.persistent' and t.__name__ == 'Persistent')
                if not ok:
                    return False
                return t.__getattribute__ is B.object.__getattribute__
            except BaseException:
                return False

        def kind_of(v):
            t = B.type(v)
            if t is B.tuple:
                return 'tuple'
            if trusted(t):
                return 'dict' if B.issubclass(t, B.dict) else 'list'
            if is_obj(v):
                return 'obj'
            return None

        def obj_dict(o):
            try:
                d = B.object.__getattribute__(o, '__dict__')
            except BaseException:
                return None
            return d if B.type(d) is B.dict else None

        def slot_items(o):
            out = []
            t = B.type(o)
            try:
                mro = t.__mro__
            except BaseException:
                return out
            for klass in mro:
                try:
                    kd = klass.__dict__
                    sl = kd.get('__slots__')
                except BaseException:
                    continue
                if sl is None:
                    continue
                if B.type(sl) is B.str:
                    sl = (sl,)
                try:
                    names = B.list(sl)
                except BaseException:
                    continue
                for name in names:
                    if B.type(name) is not B.str or name.startswith('__'):
                        continue
                    desc = kd.get(name)
                    if B.type(desc) is not types.MemberDescriptorType:
                        continue
                    try:
                        out.append((name, desc.__get__(o, t)))
                    except BaseException:
                        continue
            return out

        def children(o, kind):
            out = []
            if kind == 'dict':
                for k, v in B.list(B.dict.items(o)):
                    tk = B.type(k)
                    if tk is B.str or (tk is B.int and -SAFE <= k <= SAFE):
                        out.append((['k', k], v))
            elif kind == 'list':
                for i in B.range(B.list.__len__(o)):
                    out.append((['i', i], B.list.__getitem__(o, i)))
            elif kind == 'tuple':
                for i in B.range(B.tuple.__len__(o)):
                    out.append((['i', i], B.tuple.__getitem__(o, i)))
            elif kind == 'obj':
                d = obj_dict(o)
                persistent = B.type(o).__name__ == 'Persistent'
                if d is not None:
                    for k, v in B.list(B.dict.items(d)):
                        if B.type(k) is B.str and not k.startswith('__') and not (persistent and k.startswith('_')):
                            out.append((['a', k], v))
                for name, v in slot_items(o):
                    out.append((['a', name], v))
            return out

        def describe(v):
            t = B.type(v)
            if t is B.bool:
                return 'bool', ('true' if v else 'false'), True
            if t is B.int:
                try:
                    return 'int', B.str(v), (-SAFE <= v <= SAFE)
                except BaseException:
                    return 'int', '(too large)', False
            if t is B.float:
                if v != v or v in (float('inf'), float('-inf')):
                    return 'float', B.repr(v), False
                return 'float', B.repr(v), True
            if t is B.str:
                return 'str', v[:200], True
            return 'unavailable', '(unavailable)', False

        def make_matcher(q):
            ql = q.lower()
            qnum = None
            if NUM.match(q):
                try:
                    qnum = float(q)
                    if qnum in (float('inf'), float('-inf')):
                        qnum = None
                except BaseException:
                    qnum = None

            def m(v):
                t = B.type(v)
                if t is B.str:
                    return v.lower() == ql
                if t is B.bool:
                    return (ql == 'true') if v else (ql == 'false')
                if t is B.int or t is B.float:
                    if qnum is None:
                        return False
                    try:
                        if t is B.int and not (-SAFE <= v <= SAFE):
                            return False
                        return float(v) == qnum
                    except BaseException:
                        return False
                return False
            return m

        def label(segs):
            out = []
            for s in segs:
                k = s[0]
                if k == 'g':
                    out.append(s[1])
                elif k == 'a':
                    out.append('.' + s[1])
                elif k == 'i':
                    out.append('[' + B.str(s[1]) + ']')
                else:
                    out.append('[' + B.ascii(s[1]) + ']')
            return ''.join(out)[:300]

        def valid_segs(segs):
            if B.type(segs) is not B.list or not segs or B.len(segs) > 32:
                return False
            for i, s in B.enumerate(segs):
                if B.type(s) is not B.list or B.len(s) != 2 or B.type(s[0]) is not B.str:
                    return False
                if s[0] == 'g':
                    if i != 0 or B.type(s[1]) is not B.str:
                        return False
                elif s[0] in ('a',):
                    if i == 0 or B.type(s[1]) is not B.str:
                        return False
                elif s[0] == 'i':
                    if i == 0 or B.type(s[1]) is not B.int or s[1] < 0:
                        return False
                elif s[0] == 'k':
                    if i == 0:
                        return False
                    if not (B.type(s[1]) is B.str or (B.type(s[1]) is B.int and -SAFE <= s[1] <= SAFE)):
                        return False
                else:
                    return False
            return segs[0][0] == 'g'

        def resolve(segs):
            if not valid_segs(segs):
                return None
            v = B.dict.get(G, segs[0][1], MISSING)
            if v is MISSING:
                return None
            parent, pkind, key = G, 'store', segs[0][1]
            for s in segs[1:]:
                k = kind_of(v)
                if k is None:
                    return None
                t = s[0]
                if t == 'a':
                    if k != 'obj':
                        return None
                    d = obj_dict(v)
                    nv = B.dict.get(d, s[1], MISSING) if d is not None else MISSING
                    if nv is MISSING:
                        for name, sv in slot_items(v):
                            if name == s[1]:
                                nv = sv
                                break
                    if nv is MISSING:
                        return None
                elif t == 'k':
                    if k != 'dict':
                        return None
                    nv = B.dict.get(v, s[1], MISSING)
                    if nv is MISSING:
                        return None
                else:
                    if k == 'list':
                        if s[1] >= B.list.__len__(v):
                            return None
                        nv = B.list.__getitem__(v, s[1])
                    elif k == 'tuple':
                        if s[1] >= B.tuple.__len__(v):
                            return None
                        nv = B.tuple.__getitem__(v, s[1])
                    else:
                        return None
                parent, pkind, key, v = v, k, s[1], nv
            return {'parent': parent, 'pkind': pkind, 'key': key, 'value': v}

        RO_set = None
        for modname in ('renpy.revertable', 'renpy.python'):
            try:
                mod = __import__(modname, fromlist=['RevertableObject'])
                RO_set = mod.RevertableObject.__setattr__
                break
            except BaseException:
                continue

        def can_write(r):
            pk = r['pkind']
            if pk == 'store':
                return True
            if pk == 'obj':
                try:
                    s = B.type(r['parent']).__setattr__
                    return s is B.object.__setattr__ or (RO_set is not None and s is RO_set)
                except BaseException:
                    return False
            if pk in ('dict', 'list'):
                return True
            return False

        def item_for(segs, r):
            tn, text, ok = describe(r['value'])
            cls = ''
            if r['pkind'] == 'obj':
                try:
                    cls = B.type(r['parent']).__name__[:60]
                except BaseException:
                    cls = ''
            return {'segs': segs, 'label': label(segs), 'type': tn, 'value': text,
                    'writable': B.bool(ok and can_write(r)), 'cls': cls}

        def get_state():
            return sys.modules.get('_gve_state')

        def drop_state():
            sys.modules.pop('_gve_state', None)

        if op == 'probe':
            info = {'python': B.list(sys.version_info[:3]), 'renpy': None}
            try:
                import renpy as _r
                vt = getattr(_r, 'version_tuple', None)
                if vt is not None:
                    info['renpy'] = [B.int(x) for x in B.tuple(vt)[:3] if B.type(x) is B.int]
            except BaseException:
                pass
            return {'v': 1, 'ok': True, 'info': info}

        if op == 'abort':
            drop_state()
            return {'v': 1, 'ok': True}

        if op == 'start':
            q = args.get('query')
            if B.type(q) is not B.str or not q:
                return fail('Enter a search value.')
            st = types.ModuleType('_gve_state')
            st.wid = args.get('wid')
            st.q = q
            st.queue = []
            st.cursor = 0
            st.seen = {}
            st.found = []
            st.checks = 0
            st.elapsed = 0.0
            st.trunc = False
            st.names = [n for n in B.list(B.dict.keys(G)) if B.type(n) is B.str and not n.startswith('_')]
            st.nameidx = 0
            sys.modules['_gve_state'] = st
            return {'v': 1, 'ok': True}

        if op == 'next':
            st = get_state()
            if st is None or st.wid != args.get('wid'):
                return fail('The search was replaced. Search again.')
            match = make_matcher(st.q)
            t0 = time.perf_counter()

            def spent():
                return st.checks >= MAXCHECKS or B.len(st.found) >= MAXRESULTS or st.elapsed + (time.perf_counter() - t0) > TOTAL

            def visit(child, segs, depth, cls):
                st.checks += 1
                tn = B.type(child)
                if tn is B.bool or tn is B.int or tn is B.float or tn is B.str:
                    if match(child):
                        st.found.append((segs, cls))
                    return
                k = kind_of(child)
                if k is None or B.id(child) in st.seen:
                    return
                if depth >= MAXDEPTH or B.len(st.queue) >= MAXQUEUE:
                    st.trunc = True
                    return
                st.seen[B.id(child)] = child
                st.queue.append((child, k, segs))

            done = False
            while True:
                if spent():
                    st.trunc = True
                    done = True
                    break
                if time.perf_counter() - t0 > SLICE:
                    break
                if st.nameidx < B.len(st.names):
                    name = st.names[st.nameidx]
                    st.nameidx += 1
                    child = B.dict.get(G, name, MISSING)
                    if child is not MISSING:
                        visit(child, [['g', name]], 1, '')
                    continue
                if st.cursor >= B.len(st.queue):
                    done = True
                    break
                obj, k, segs = st.queue[st.cursor]
                st.queue[st.cursor] = None
                st.cursor += 1
                cls = ''
                if k == 'obj':
                    try:
                        cls = B.type(obj).__name__[:60]
                    except BaseException:
                        cls = ''
                try:
                    kids = children(obj, k)
                except BaseException:
                    continue
                for seg, child in kids:
                    if st.checks >= MAXCHECKS or B.len(st.found) >= MAXRESULTS:
                        st.trunc = True
                        break
                    visit(child, segs + [seg], B.len(segs) + 1, cls)
            st.elapsed += time.perf_counter() - t0
            out = {'v': 1, 'ok': True, 'done': done, 'checks': st.checks, 'trunc': B.bool(st.trunc)}
            if done:
                results = []
                for segs, cls in st.found[:MAXRESULTS]:
                    r = resolve(segs)
                    if r is not None:
                        results.append(item_for(segs, r))
                out['results'] = results
                drop_state()
            return out

        if op == 'narrow':
            q = args.get('query')
            all_segs = args.get('segs')
            if B.type(q) is not B.str or not q:
                return fail('Enter a search value.')
            if B.type(all_segs) is not B.list:
                return fail('Bad request.')
            match = make_matcher(q)
            results = []
            for segs in all_segs[:MAXRESULTS]:
                r = resolve(segs)
                if r is not None and match(r['value']):
                    results.append(item_for(segs, r))
            return {'v': 1, 'ok': True, 'results': results}

        if op == 'set':
            segs = args.get('segs')
            expect = args.get('expect')
            val = args.get('value')
            r = resolve(segs)
            if r is None:
                return fail('This value is no longer available. Search again.')
            cur = r['value']
            tn, _text, ok = describe(cur)
            if tn != expect or tn == 'unavailable':
                return fail('The value changed type. Search again.')
            if not ok or not can_write(r):
                return fail('This value is read-only.')
            if B.type(val) is not B.dict or B.type(val.get('s')) is not B.str or val.get('t') != tn:
                return fail('Bad replacement value.')
            s = val['s']
            if tn == 'int':
                if not INT.match(s):
                    return fail('Enter a whole number.')
                new = B.int(s)
                if not (-SAFE <= new <= SAFE):
                    return fail('Enter a whole number.')
            elif tn == 'float':
                if not NUM.match(s):
                    return fail('Enter a finite number.')
                new = float(s)
                if new != new or new in (float('inf'), float('-inf')):
                    return fail('Enter a finite number.')
            elif tn == 'bool':
                if s not in ('true', 'false'):
                    return fail('Enter true or false.')
                new = (s == 'true')
            else:
                new = s
            pk, parent, key = r['pkind'], r['parent'], r['key']
            if pk == 'store':
                G[key] = new
            elif pk == 'obj':
                B.setattr(parent, key, new)
            else:
                parent[key] = new
            r2 = resolve(segs)
            if r2 is None or B.type(r2['value']) is not B.type(new) or r2['value'] != new:
                return fail('The value did not retain the change.')
            try:
                import renpy as _r2
                _r2.restart_interaction()
            except BaseException:
                pass
            return {'v': 1, 'ok': True, 'item': item_for(segs, r2)}

        return fail('Unknown operation.')
    except BaseException as e:
        try:
            import traceback
            tb = traceback.format_exc()[-3000:]
        except BaseException:
            tb = ''
        return {'v': 1, 'ok': False, 'error': (B.type(e).__name__ + ': ' + B.str(e))[:300], 'traceback': tb}

result = _gve_main("__GVE_ARGS__")
`;
