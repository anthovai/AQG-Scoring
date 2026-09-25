import re, json, io
lines=[l.strip() for l in open('scoring_docx.txt',encoding='utf8').read().splitlines()]
opts={}   # id -> {text, score}
order=[]
i=0
while i<len(lines):
    m=re.fullmatch(r'(S[147]_\d_[A-E])',lines[i])
    if m and i+2<len(lines):
        cid=m.group(1)
        a,b=lines[i+1],lines[i+2]
        if a.startswith('"') and re.fullmatch(r'[1-5]',b):
            if cid not in opts:
                opts[cid]={'id':cid,'text':a.strip('"'),'score':int(b)}
                order.append(cid)
            i+=3; continue
    i+=1
# behavior tags: id, score, tag, advice
tags={}
i=0
while i<len(lines):
    m=re.fullmatch(r'(S[147]_\d_[A-E])',lines[i])
    if m and i+3<len(lines) and re.fullmatch(r'[1-5]',lines[i+1]):
        cid=m.group(1)
        tags[cid]={'score':int(lines[i+1]),'tag':lines[i+2],'advice':lines[i+3]}
    i+=1
print('options',len(opts),'tags',len(tags))
for cid in order:
    if cid in tags:
        assert tags[cid]['score']==opts[cid]['score'], cid
        opts[cid]['tag']=tags[cid]['tag']; opts[cid]['advice']=tags[cid]['advice']
    else: print('MISSING TAG',cid)
json.dump([opts[c] for c in order],open('options.json','w',encoding='utf8'),ensure_ascii=False,indent=1)
print(order)
