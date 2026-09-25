# -*- coding: utf-8 -*-
"""Generate aqg/data/game.js from the AQG scoring documents.

TWO sources, on purpose — verified against the rendered videos frame by frame:

  scoring_docx.txt   = "AQG scoring Aug" (ฉบับล่าสุด, 5 ก.ย.)
      → คำถาม / inner question / ตัวเลือก 30 ข้อ / คะแนน / Behavior Tag / คำแนะนำ
        (การ์ดตัวเลือกในวีดีโอใช้ข้อความชุดนี้ ตรวจแล้วทั้ง 4 ข้อที่สองฉบับต่างกัน:
         S1_1_E, S1_3_C, S1_3_D, S1_4_E)

  scoring_aug30.txt  = "AQG scoring Aug 30"
      → บทบรรยาย / ฉาก / เสียงวิทยุคั่นกลาง ของทั้ง 3 ด่าน
        (เสียงพูดในวีดีโอใช้เนื้อเรื่องชุดนี้ = ภารกิจ "เข้าตียึดที่หมาย"
         ยืนยันจากซับในวีดีโอ เช่น S01 t=105s "จะให้ดำเนินการยึดที่หมายต่อ
         หรือหยุดปฏิบัติภารกิจการครับ" และ S03 t=46-50s "มีผู้ต้องสงสัย
         ลักลอบวางระเบิดเข้าพื้นที่ / ให้ติดตามจับกุมในโอกาสแรก")

ถ้า render วีดีโอใหม่จากฉบับเดียว ให้เปลี่ยน NARRATION ให้ชี้ไฟล์เดียวกันทั้งคู่
"""
import json, re, os, io
from keymap import KEYS

# ── แหล่งข้อมูล ──────────────────────────────────────────────────────────────
# MASTER = ฉบับล่าสุด = แหล่งอ้างอิงหลักของ "คำถาม / ตัวเลือก / คะแนน / tag"
MASTER = 'scoring_docx.txt'      # AQG scoring Aug  (ล่าสุด)
# NARRATION_SOURCE = ฉบับที่ใช้เป็น "บทบรรยาย / ฉาก / เสียงวิทยุคั่นกลาง"
#   'scoring_aug30.txt' = ตรงกับเสียงพูดในวีดีโอที่ render มาแล้ว (ค่าเริ่มต้น)
#   MASTER              = ตามฉบับล่าสุด (ใช้เมื่อ render วีดีโอใหม่จากฉบับล่าสุด)
NARRATION_SOURCE = 'scoring_aug30.txt'

def _load(fn):
    return [l.strip().replace('\xa0',' ')
            for l in open(fn,encoding='utf8').read().split('\n')]
L = _load(MASTER)
NARRATION = L if NARRATION_SOURCE == MASTER else _load(NARRATION_SOURCE)

def K(k, lines=None):
    pat=KEYS[k]
    for l in (lines if lines is not None else L):
        if pat in l: return l
    raise KeyError(k)
def N(*keys):
    """บทบรรยาย/ฉาก/วิทยุ — จากฉบับที่ NARRATION_SOURCE ชี้ไว้
    รับได้หลาย key: ใช้ key แรกที่หาเจอ (บางบรรทัดมีแค่ในฉบับใดฉบับหนึ่ง)"""
    for lines in (NARRATION, L):
        for k in keys:
            try:
                return K(k, lines)
            except KeyError:
                continue
    raise KeyError(keys)
opts=json.load(open('options.json',encoding='utf8'))
byq={}
for o in opts: byq.setdefault(o['id'][:4],[]).append(o)

def split_tag(s):
    m=re.match(r'^\[(.+?)\]\s*(.*)$',s)
    return (m.group(1).strip(),m.group(2).strip()) if m else (None,s.strip())
def radio(*k):
    cue,rest=split_tag(N(*k))
    m=re.match(r'^(.+?):\s*(.*)$',rest)
    sp,txt=(m.group(1).strip(),m.group(2).strip()) if m else (None,rest)
    return {'kind':'radio','cue':cue,'speaker':sp,'text':re.sub(r'\s+',' ',txt.strip('"\u201c\u201d ')).strip()}
def visual(*k):
    cue,rest=split_tag(N(*k))
    t=cue or rest
    if cue and rest: t=cue+' \u2014 '+rest
    return {'kind':'visual','text':t}
def narrate(*k):
    return {'kind':'narration','text':re.sub(r'^\u0e1a\u0e23\u0e23\u0e22\u0e32\u0e22:\s*','',N(*k))}
def closing(*k):
    raw=N(*k)
    cue,_=split_tag(raw)
    t=re.sub(r'^\[.*?\]\s*','',raw)
    t=re.sub(r'^\u0e1a\u0e23\u0e23\u0e22\u0e32\u0e22:\s*','',t)
    return ([{'kind':'visual','text':cue}] if cue else [])+[{'kind':'narration','text':t}]
def strip_q(k,pref):
    return re.sub(r'^(\u0e04\u0e33\u0e16\u0e32\u0e21\s*)?'+pref+r'\s*','',K(k)).strip()
# ── video cue calibration ────────────────────────────────────────────────────
# Each stage video already renders its own question screen: five cards in a ring
# labelled A-E with a 20 s countdown. The cards fade in one at a time; the answer
# window runs from "all five visible" to the moment the screen cuts away.
#   cue   = [start, end] in seconds of that stage's video
#   slots = the on-screen letter -> the document's choice_id.
# The video's own lettering is NOT the document's lettering (the render is already
# position-shuffled), so this table is what keeps scoring tied to choice_id.
# Measured from the frames in tools/shots/ (see README "การ calibrate cue").
CUES={
 'S1_1':{'cue':[75.0,95.5], 'slots':{'A':'S1_1_A','B':'S1_1_C','C':'S1_1_E','D':'S1_1_D','E':'S1_1_B'}},
 'S1_2':{'cue':[179.0,200.0],'slots':{'A':'S1_2_B','B':'S1_2_E','C':'S1_2_A','D':'S1_2_D','E':'S1_2_C'}},
 'S1_3':{'cue':[270.0,292.0],'slots':{'A':'S1_3_D','B':'S1_3_A','C':'S1_3_C','D':'S1_3_E','E':'S1_3_B'}},
 'S1_4':{'cue':[359.0,376.0],'slots':{'A':'S1_4_E','B':'S1_4_B','C':'S1_4_D','D':'S1_4_C','E':'S1_4_A'}},
 'S4_1':{'cue':[121.0,143.0],'slots':{'A':'S4_1_C','B':'S4_1_D','C':'S4_1_B','D':'S4_1_A','E':'S4_1_E'}},
 'S7_1':{'cue':[95.0,113.0], 'slots':{'A':'S7_1_E','B':'S7_1_D','C':'S7_1_B','D':'S7_1_A','E':'S7_1_C'}},
}

def q(qid,dim,beat,inner,prompt,pre):
    c=CUES[qid]
    ids=set(o['id'] for o in byq[qid])
    assert set(c['slots'].values())==ids, qid
    return {'id':qid,'dimension':dim,'beat':beat,'innerQuestion':inner,'prompt':prompt,'pre':pre,
            'cue':{'start':c['cue'][0],'end':c['cue'][1]},
            'slots':[{'label':k,'choiceId':c['slots'][k]} for k in ('A','B','C','D','E')],
            'options':[{kk:o[kk] for kk in ('id','text','score','tag','advice')} for o in byq[qid]]}

WAT=re.compile(r'^\u0e27\u0e31\u0e14:\s*')  # "วัด:"

data={
 'meta':{
  'title':'AQG',
  'subtitle':'\u0e15\u0e49\u0e19\u0e41\u0e1a\u0e1a\u0e40\u0e01\u0e21\u0e1b\u0e23\u0e30\u0e40\u0e21\u0e34\u0e19\u0e04\u0e27\u0e32\u0e21\u0e09\u0e25\u0e32\u0e14\u0e43\u0e19\u0e01\u0e32\u0e23\u0e40\u0e1c\u0e0a\u0e34\u0e0d\u0e27\u0e34\u0e01\u0e24\u0e15\u0e34 (AQ) \u0e41\u0e25\u0e30\u0e04\u0e27\u0e32\u0e21\u0e21\u0e38\u0e48\u0e07\u0e21\u0e31\u0e48\u0e19 (GRIT)',
  'timerSeconds':20,
  'scoreMap':{'A':5,'B':4,'C':3,'D':2,'E':1},
  # The stage videos render the five options at fixed ring positions, so the
  # per-session shuffle from the document cannot be applied on top of them.
  # The render is itself position-shuffled (see `slots`), and every decision
  # still stores the slot it was picked from for position-bias analysis.
  # `?panel=1` switches to the panel mode, which does shuffle per session.
  'shuffleOptions':False,
  # clickable hotspots over the video, as fractions of the video picture
  'hotspots':{
    'A':[0.27,0.02,0.75,0.35],
    'B':[0.62,0.35,0.99,0.56],
    'C':[0.54,0.65,0.94,0.88],
    'D':[0.06,0.65,0.44,0.88],
    'E':[0.01,0.35,0.38,0.56],
  },
  # S00 = \u0e27\u0e35\u0e14\u0e35\u0e42\u0e2d\u0e44\u0e17\u0e40\u0e17\u0e34\u0e25 + \u0e04\u0e33\u0e0a\u0e35\u0e49\u0e41\u0e08\u0e07 (\u0e40\u0e25\u0e48\u0e19\u0e2b\u0e25\u0e31\u0e07\u0e01\u0e14 START \u0e02\u0e49\u0e32\u0e21\u0e44\u0e14\u0e49)
  'titleVideo':'video/S00-web.mp4',
  'titleVideoFallback':'video/S00.mp4',
  'researchNote':'\u0e1c\u0e25\u0e19\u0e35\u0e49\u0e40\u0e1b\u0e47\u0e19\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e15\u0e49\u0e19\u0e41\u0e1a\u0e1a',
  'structure':'\u0e42\u0e04\u0e23\u0e07\u0e2a\u0e23\u0e49\u0e32\u0e07 3 \u0e14\u0e48\u0e32\u0e19 / 6 \u0e08\u0e38\u0e14\u0e15\u0e31\u0e14\u0e2a\u0e34\u0e19\u0e43\u0e08 / \u0e04\u0e23\u0e2d\u0e1a\u0e04\u0e25\u0e38\u0e21 6 \u0e21\u0e34\u0e15\u0e34 AQ-GRIT \u2014 S1 \u2192 S4 \u2192 S7',
  'intro':[K('intro1').strip('\u201c\u201d '),K('intro2'),K('intro3'),K('intro4'),K('intro5').strip('\u201c\u201d ')],
  'dimensions':[
    {'key':'AQ-Control','th':'\u0e01\u0e32\u0e23\u0e04\u0e27\u0e1a\u0e04\u0e38\u0e21','from':'S1_1'},
    {'key':'AQ-Ownership','th':'\u0e04\u0e27\u0e32\u0e21\u0e23\u0e31\u0e1a\u0e1c\u0e34\u0e14\u0e0a\u0e2d\u0e1a','from':'S1_2'},
    {'key':'AQ-Reach','th':'\u0e02\u0e2d\u0e1a\u0e40\u0e02\u0e15\u0e1c\u0e25\u0e01\u0e23\u0e30\u0e17\u0e1a','from':'S1_3'},
    {'key':'AQ-Endurance','th':'\u0e04\u0e27\u0e32\u0e21\u0e04\u0e07\u0e17\u0e19\u0e02\u0e2d\u0e07\u0e1c\u0e25\u0e01\u0e23\u0e30\u0e17\u0e1a','from':'S1_4'},
    {'key':'GRIT-Passion','th':'\u0e04\u0e27\u0e32\u0e21\u0e21\u0e38\u0e48\u0e07\u0e21\u0e31\u0e48\u0e19\u0e15\u0e48\u0e2d\u0e40\u0e1b\u0e49\u0e32\u0e2b\u0e21\u0e32\u0e22','from':'S4_1'},
    {'key':'GRIT-Perseverance','th':'\u0e04\u0e27\u0e32\u0e21\u0e40\u0e1e\u0e35\u0e22\u0e23\u0e2b\u0e25\u0e31\u0e07\u0e04\u0e27\u0e32\u0e21\u0e25\u0e49\u0e21\u0e40\u0e2b\u0e25\u0e27','from':'S7_1','anchor':True,
     'note':'Anchor scenario \u2014 \u0e19\u0e49\u0e33\u0e2b\u0e19\u0e31\u0e01\u0e2a\u0e39\u0e07\u0e2a\u0e38\u0e14\u0e15\u0e32\u0e21\u0e1c\u0e25\u0e16\u0e14\u0e16\u0e2d\u0e22 (\u03b2=+0.300)'},
  ],
  # เอกสารเขียนว่า "Control x Passion สูงพร้อมกัน" โดยไม่ระบุตัวเลข
  # ใช้ 4 ให้สอดคล้องกับเกณฑ์ "จุดเด่น = 4-5" ในเอกสารหน้า Behavior Tag
  # ถ้าต้องการให้เตือนเฉพาะกรณีเต็ม 5 ทั้งคู่ เปลี่ยน threshold เป็น 5
  'dualFlag':{'dims':['AQ-Control','GRIT-Passion'],'threshold':4,
    'title':'\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e23\u0e23\u0e30\u0e27\u0e31\u0e07 (Dual-radar flag)',
    'text':'Control \u0e41\u0e25\u0e30 Passion \u0e2a\u0e39\u0e07\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e01\u0e31\u0e19 = \u0e40\u0e2a\u0e35\u0e48\u0e22\u0e07 overcommitment \u2014 \u0e23\u0e30\u0e27\u0e31\u0e07\u0e01\u0e32\u0e23\u0e23\u0e31\u0e1a\u0e20\u0e32\u0e23\u0e30\u0e40\u0e01\u0e34\u0e19\u0e01\u0e33\u0e25\u0e31\u0e07'},
 },
 'stages':[
  {'id':'S1','no':1,
   'title':'\u0e04\u0e37\u0e19\u0e17\u0e35\u0e48\u0e41\u0e1c\u0e19\u0e40\u0e1b\u0e25\u0e35\u0e48\u0e22\u0e19',
   'subtitle':'S1: \u0e01\u0e32\u0e23\u0e40\u0e1b\u0e25\u0e35\u0e48\u0e22\u0e19\u0e41\u0e1b\u0e25\u0e07\u0e20\u0e32\u0e23\u0e01\u0e34\u0e08 (Mission Change)',
   'measures':WAT.sub('',K('s1_measures')),
   'video':'video/S01-web.mp4','videoFallback':'video/S01.mp4','poster':'assets/poster-s01.jpg',
   'scene':visual('s1_scene')['text'].split(' \u2014 ')[0],
   'opening':[narrate('s1_narr'),radio('s1_radio')],
   # ฉบับ Aug 30 ปิดด่าน 1 ด้วยโน้ตภาพ (ไม่ใช่บทบรรยายให้ผู้เล่นอ่าน)
   'closing':[visual('s1_close_narr','s1_close')],
   'questions':[
     q('S1_1','AQ-Control','\u0e08\u0e31\u0e07\u0e2b\u0e27\u0e30\u0e17\u0e35\u0e48 1 \u2014 AQ-Control',strip_q('q11_inner',r'1\.1:'),strip_q('q11_prompt',r'1\.1:'),[]),
     q('S1_2','AQ-Ownership','\u0e08\u0e31\u0e07\u0e2b\u0e27\u0e30\u0e17\u0e35\u0e48 2 \u2014 AQ-Ownership',strip_q('q12_inner',r'1\.2:'),strip_q('q12_prompt',r'1\.2:'),[radio('i12_radio'),visual('i12_vis')]),
     q('S1_3','AQ-Reach','\u0e08\u0e31\u0e07\u0e2b\u0e27\u0e30\u0e17\u0e35\u0e48 3 \u2014 AQ-Reach',strip_q('q13_inner',r'1\.3:'),strip_q('q13_prompt',r'1\.3:'),[radio('i13_radio'),visual('i13_vis')]),
     q('S1_4','AQ-Endurance','\u0e08\u0e31\u0e07\u0e2b\u0e27\u0e30\u0e17\u0e35\u0e48 4 \u2014 AQ-Endurance',strip_q('q14_inner',r'1\.4:'),strip_q('q14_prompt',r'1\.4:'),[radio('i14_radio')]),
   ]},
  {'id':'S4','no':2,
   'title':'\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07\u0e22\u0e49\u0e32\u0e22',
   'subtitle':'S4: \u0e01\u0e32\u0e23\u0e42\u0e22\u0e01\u0e22\u0e49\u0e32\u0e22\u0e23\u0e30\u0e2b\u0e27\u0e48\u0e32\u0e07\u0e20\u0e32\u0e23\u0e01\u0e34\u0e08',
   'measures':WAT.sub('',K('s4_measures')),
   'video':'video/S02-web.mp4','videoFallback':'video/S02.mp4','poster':'assets/poster-s02.jpg',
   'scene':visual('s4_scene')['text'],
   'opening':[narrate('s4_narr'),{'kind':'narration','text':N('s4_narr2')},radio('s4_phone')],
   'closing':closing('s4_close'),
   'questions':[q('S4_1','GRIT-Passion','GRIT-Passion',strip_q('q41_inner',r'4\.1:'),strip_q('q41_prompt',r'4\.1:'),[])]},
  {'id':'S7','no':3,
   'title':'\u0e2b\u0e25\u0e31\u0e07\u0e04\u0e27\u0e32\u0e21\u0e25\u0e49\u0e21\u0e40\u0e2b\u0e25\u0e27',
   'subtitle':'S7: \u0e20\u0e32\u0e23\u0e01\u0e34\u0e08\u0e2b\u0e25\u0e31\u0e07\u0e04\u0e27\u0e32\u0e21\u0e25\u0e49\u0e21\u0e40\u0e2b\u0e25\u0e27 (Anchor / Benchmark)',
   'measures':WAT.sub('',K('s7_measures')),
   'video':'video/S03-web.mp4','videoFallback':'video/S03.mp4','poster':'assets/poster-s03.jpg',
   'scene':visual('s7_scene')['text'],
   'opening':[narrate('s7_narr'),visual('s7_timecut'),radio('s7_radio'),visual('s7_vis')],
   'closing':closing('s7_close'),
   'questions':[q('S7_1','GRIT-Perseverance','GRIT-Perseverance (Anchor)',strip_q('q71_inner',r'7\.1:'),strip_q('q71_prompt',r'7\.1:'),[])]},
 ],
}
assert sum(len(s['questions']) for s in data['stages'])==6
for s in data['stages']:
    for qq in s['questions']:
        assert len(qq['options'])==5
        assert sorted(o['score'] for o in qq['options'])==[1,2,3,4,5]
        for o in qq['options']:
            assert o['tag'] and o['advice'] and o['text']
out=r'E:\Model Business\งาน app จำลองสถานะการ\aqg\data'
os.makedirs(out,exist_ok=True)
js=('/* AUTO-GENERATED from "AQG scoring Aug" - do not hand-edit option text/scores.\n'
    '   Regenerate with tools/gen_data.py */\n'
    'window.AQG_DATA = '+json.dumps(data,ensure_ascii=False,indent=1)+';\n')
io.open(os.path.join(out,'game.js'),'w',encoding='utf8').write(js)
print('OK',len(js),'bytes')
