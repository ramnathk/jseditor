"""Fake Ren'Py store used to run the real packaged Python program with real Python semantics.

Protocol (stdin/stdout, one JSON object per line):
  {"source": "<python>"}  -> exec like renpy-pre.js does: exec(source, store, {}); reply {"data": result}
  {"eval": "<expr>"}      -> evaluate against the store, reply {"data": value}
Replies are produced with json.dumps, like the real wrapper. Run with: python3 -I harness.py
"""
import builtins, json, os, sys, types

# --- minimal fake of renpy.revertable / renpy.exports --------------------------------------------
renpy = types.ModuleType('renpy')
renpy.version_tuple = (8, 2, 1, 0)
renpy.restarts = 0
renpy.mutated = []
def restart_interaction(): renpy.restarts += 1
renpy.restart_interaction = restart_interaction
rv = types.ModuleType('renpy.revertable')
def mutator(method):
    def wrapped(self, *a, **k):
        renpy.mutated.append(a[0] if a else None)
        return method(self, *a, **k)
    return wrapped
class RevertableObject(object):
    __setattr__ = mutator(object.__setattr__)
class RevertableDict(dict):
    __setitem__ = mutator(dict.__setitem__)
class RevertableList(list):
    __setitem__ = mutator(list.__setitem__)
class RevertableDefaultDict(dict):
    def __missing__(self, k):
        renpy.mutated.append('missing-called')
        self[k] = 0
        return 0
for cls in (RevertableObject, RevertableDict, RevertableList, RevertableDefaultDict): cls.__module__ = 'renpy.revertable'
rv.RevertableObject, rv.RevertableDict, rv.RevertableList, rv.RevertableDefaultDict = RevertableObject, RevertableDict, RevertableList, RevertableDefaultDict
renpy.revertable = rv
pers = types.ModuleType('renpy.persistent')
class Persistent(object):
    def __getattr__(self, name):
        return None
Persistent.__module__ = 'renpy.persistent'
pers.Persistent = Persistent
sys.modules.update({'renpy': renpy, 'renpy.revertable': rv, 'renpy.persistent': pers})

calls = {'getter': 0, 'getattr': 0, 'eq': 0}
# --- game fixture ----------------------------------------------------------------------------------
store = {'__builtins__': builtins}
store.update(dict=RevertableDict, list=RevertableList, object=RevertableObject)   # shadowed like minstore.py
class Board(RevertableObject):
    def __init__(self):
        self.moves_left = 14; self.score = 0; self.title = 'Match'; self.cells = RevertableList([1, 2, 3])
    @property
    def trap(self):
        calls['getter'] += 1; return 14
    def __getattr__(self, name):
        calls['getattr'] += 1; raise AttributeError(name)
Board.__module__ = 'store'
class Slotted(object):
    __slots__ = ('hp',)
    def __init__(self): self.hp = 77
Slotted.__module__ = 'store'
class Evil(object):
    __module__ = 'store'
    def __getattribute__(self, name):
        calls['getattr'] += 1; return 5
class Cmp(float):
    def __eq__(self, other):
        calls['eq'] += 1; return True
    __hash__ = float.__hash__
class Stringy(str): pass
store.update(
    diff_moves=15, player_name='Derek', flag=True, one=1, ratio=0.5, huge=2 ** 60, nan=float('nan'), emoji='café \U0001F4A5',
    game_board=Board(), slotted=Slotted(), evil=Evil(), subfloat=Cmp(15.0), substr=Stringy('Derek'),
    inv=RevertableDict({'gold': 15, 7: 15, True: 15, 'bag': [15, (15, 'x')], (1, 2): 15}),
    dd=RevertableDefaultDict({'a': 15}), pos=(15, 16), cycle=None, persistent=Persistent(), _hidden=15, _private_obj=Board(),
    some_module=types.ModuleType('some'), some_func=lambda: 15,
)
store['cycle'] = RevertableDict(); store['cycle']['self'] = store['cycle']; store['cycle']['n'] = 15
store['persistent'].__dict__['coins'] = 15
store['persistent'].__dict__['_internal'] = 15

if os.environ.get('GVE_BIG'):
    store['big'] = RevertableList(range(200000))

for line in sys.stdin:
    req = json.loads(line)
    try:
        if 'source' in req:
            src = req['source']
            if any(ord(c) > 127 for c in src): raise ValueError('non-ascii source')
            loc = {}
            exec(src, store, loc)
            reply = {'data': loc.get('result')}
        elif 'eval' in req:
            reply = {'data': eval(req['eval'], dict(store, calls=calls, renpy=renpy))}
        else:
            reply = {'error': 'bad'}
        out = json.dumps(reply)
    except Exception as e:
        out = json.dumps({'error': str(e), 'name': type(e).__name__})
    sys.stdout.write(out + '\n'); sys.stdout.flush()
