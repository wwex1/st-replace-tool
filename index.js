// ═══════════════════════════════════════════════════════
// Replace & Summary Tool (SillyTavern Extension)
// ═══════════════════════════════════════════════════════

const MODULE_NAME = "st-replace-tool";

jQuery(async () => {
    console.log("[RT] 확장프로그램 로딩...");

    const { getContext } = SillyTavern;

    // ═════════════════════════════════════════════
    // 🔄 파트 1: 텍스트 치환
    // ═════════════════════════════════════════════

    const replacePopupHtml = `
    <div id="rt-bg"></div>
    <div id="rt-popup">
        <div class="rt-header">
            <span>🔄 텍스트 치환</span>
            <span class="rt-msg-badge" id="rt-msg-badge"></span>
            <span class="rt-close" id="rt-close">✕</span>
        </div>
        <div class="rt-body">
            <div id="rt-rules"></div>
            <div class="rt-options">
                <label class="rt-opt-label">
                    <input type="checkbox" id="rt-cut-infoblock" checked />
                    <span>&lt;infoblock&gt; 위까지만 치환</span>
                </label>
            </div>
            <div class="rt-actions">
                <div class="rt-btn rt-btn-add" id="rt-add">+ 규칙 추가</div>
                <div class="rt-btn rt-btn-exec" id="rt-exec">🚀 치환 실행</div>
            </div>
            <div class="rt-preview-section">
                <label>미리보기</label>
                <div id="rt-preview" class="rt-preview"></div>
            </div>
        </div>
    </div>`;
    $("body").append(replacePopupHtml);

    const bgEl = document.getElementById("rt-bg");
    const popupEl = document.getElementById("rt-popup");
    const rulesEl = document.getElementById("rt-rules");
    const previewEl = document.getElementById("rt-preview");
    const badgeEl = document.getElementById("rt-msg-badge");
    let currentMesId = null;

    function addRule(fv, rv) {
        const rule = document.createElement("div"); rule.className = "rt-rule";
        rule.innerHTML = `<textarea class="rt-find" placeholder="찾을 텍스트" rows="1">${fv||""}</textarea><textarea class="rt-replace" placeholder="바꿀 텍스트 (비우면 삭제)" rows="1">${rv||""}</textarea><div class="rt-rule-del" title="삭제">✕</div>`;
        rule.querySelector(".rt-find").addEventListener("input", updatePreview);
        rule.querySelector(".rt-replace").addEventListener("input", updatePreview);
        rule.querySelector(".rt-rule-del").addEventListener("click", () => { rule.remove(); updatePreview(); });
        rulesEl.appendChild(rule);
    }
    function getRules() { const r=[]; rulesEl.querySelectorAll(".rt-rule").forEach(el => { const f=el.querySelector(".rt-find").value, rp=el.querySelector(".rt-replace").value; if(f) r.push({find:f,replace:rp}); }); return r; }
    function applyRules(text, rules) { const cut=document.getElementById("rt-cut-infoblock").checked; let t=text,s=""; if(cut){const i=text.indexOf("<infoblock>");if(i!==-1){t=text.substring(0,i);s=text.substring(i);}} for(const r of rules) t=t.split(r.find).join(r.replace); return t+s; }
    function getRawText(id) { try{const c=getContext();if(c?.chat?.[id])return c.chat[id].mes;}catch(e){} return null; }
    function updatePreview() { const r=getRawText(currentMesId); if(r) previewEl.textContent=applyRules(r,getRules()); }
    function updateDOM(ctx,id,t) { const el=document.querySelector('.mes[mesid="'+id+'"]');if(!el)return;const mt=el.querySelector(".mes_text");if(!mt)return; try{if(typeof ctx.messageFormatting==="function"){const c=ctx.chat[id];mt.innerHTML=ctx.messageFormatting(t,c.name,c.is_system,c.is_user,id);}else mt.innerHTML=t.replace(/\n/g,"<br>");}catch(e){mt.innerHTML=t.replace(/\n/g,"<br>");} }
    function doSaveChat(ctx) { if(typeof ctx.saveChatDebounced==="function")ctx.saveChatDebounced();else if(typeof ctx.saveChat==="function")ctx.saveChat(); }

    function openReplacePopup(id) { currentMesId=Number(id);rulesEl.innerHTML="";addRule();previewEl.textContent=getRawText(currentMesId)||"(텍스트 없음)";badgeEl.textContent="#"+currentMesId;bgEl.classList.add("rt-show");popupEl.classList.add("rt-show");popupEl.style.display="flex"; }
    function closeReplacePopup() { bgEl.classList.remove("rt-show");popupEl.classList.remove("rt-show");popupEl.style.display="none";currentMesId=null; }
    function executeReplace() {
        const ctx=getContext();if(!ctx?.chat||currentMesId===null)return;const msg=ctx.chat[currentMesId];if(!msg)return;
        const rules=getRules();if(!rules.length){if(typeof toastr!=="undefined")toastr.warning("치환 규칙을 입력해주세요.");return;}
        const nt=applyRules(msg.mes,rules);if(nt===msg.mes){if(typeof toastr!=="undefined")toastr.info("변경된 내용이 없습니다.");return;}
        ctx.chat[currentMesId].mes=nt;updateDOM(ctx,currentMesId,nt);doSaveChat(ctx);
        if(typeof toastr!=="undefined")toastr.success("치환 완료!","RT",{timeOut:2000});closeReplacePopup();
    }

    document.getElementById("rt-close").addEventListener("click",closeReplacePopup);
    bgEl.addEventListener("click",closeReplacePopup);
    document.getElementById("rt-add").addEventListener("click",()=>addRule());
    document.getElementById("rt-exec").addEventListener("click",executeReplace);

    function upsertReplaceButtons() {
        document.querySelectorAll(".mes").forEach(mes => {
            const id=mes.getAttribute("mesid");if(!id)return;
            const target=mes.querySelector(".extraMesButtons")||mes.querySelector(".mes_button")||mes.querySelector(".mes_buttons");if(!target)return;
            let btn=target.querySelector(".rt-mes-btn");
            if(!btn){ btn=document.createElement("div");btn.className="rt-mes-btn mes_button";btn.innerHTML='<i class="fa-solid fa-right-left"></i>';btn.title="텍스트 치환";btn.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();const i=mes.getAttribute("mesid");if(i)openReplacePopup(i);});target.prepend(btn); }
            btn.dataset.mesid=id;
        });
    }
    const chatEl=document.getElementById("chat");
    if(chatEl){const obs=new MutationObserver(upsertReplaceButtons);obs.observe(chatEl,{childList:true,subtree:true});upsertReplaceButtons();}
    console.log("[RT] 🔄 치환 기능 활성화!");

    // ═════════════════════════════════════════════
    // 📝 파트 2: 요약 기능 (블록 UI)
    // ═════════════════════════════════════════════

    // ── 기본 프롬프트 ──
    const DEFAULT_PROMPTS = [
        { label:"📖 현재 스토리 아크 요약", prompt:`(OOC: RP 무조건 중단. 해당 채팅을 자세히 과거형으로 요약하세요. 아래 양식을 엄격히 지키세요.\n\n## Archived Story Arc (Present)\n\n- 주요 사건 요약 (담백하게, 사실만, 자세히.)\n\n한글본, 영어본으로 각각 코드블럭에 넣어줘.\n**RP는 절대 이어가지 말고 중단할 것.**` },
        { label:"📚 전체 스토리 아크 요약", prompt:`(ooc: rp를 중단하고 대답해. 내용을 절대 이어가지 마. 지금까지의 채팅 진행 상황과 전체 스토리 아크까지 전부 포함해서 자세히 과거형으로 요약하세요. 아래 양식을 엄격히 지키세요.\n\n## Archived Story Arc (Past~Present)\n\n### **Month**\n-\n-\n.\n.\n.\n\n을 한글본, 영어본으로 각각 코드블럭에 넣어줘.)\n\n**RP 절대 이어가지 말 것.**` },
        { label:"📋 현재 상태 정리", prompt:`(ooc: rp를 중단하고 대답해. 내용을 절대 이어가지 마. 지금까지의 진행 상황을 기반으로 \n\n## Current Status\n- 현재 배경 (장소, 상황, 특이점)\n- {{char}} 현재 상태(신체, 심리, 부상, 특이점 등)\n- {{user}} 현재 상태(신체, 심리, 부상, 특이점 등)\n- 계획\n- 중요 아이템 (물건이름 : 간단한 설명과 보관위치 설명)\n\n을 한글본, 영어본으로 각각 코드블럭에 넣어줘.\n\n**절대 내용을 이어가지 말고 OOC 요청에 대답할 것.**)` }
    ];

    // ── 설정 관리 ──
    const DEFAULTS = {
        apiSource: "main",
        connectionProfileId: "",
        prompts: DEFAULT_PROMPTS.map(p => ({ label: p.label, prompt: p.prompt })),
    };

    const ctx2 = getContext();
    if (!ctx2.extensionSettings[MODULE_NAME]) {
        ctx2.extensionSettings[MODULE_NAME] = structuredClone(DEFAULTS);
    }
    const cfg = ctx2.extensionSettings[MODULE_NAME];
    // 마이그레이션: 빠진 필드 채우기
    if (!cfg.prompts) cfg.prompts = structuredClone(DEFAULTS.prompts);
    if (cfg.apiSource === undefined) cfg.apiSource = "main";
    if (cfg.connectionProfileId === undefined) cfg.connectionProfileId = "";
    // 프롬프트 3개 미만이면 기본값으로 채우기
    while (cfg.prompts.length < 3) cfg.prompts.push(structuredClone(DEFAULT_PROMPTS[cfg.prompts.length]));

    function persist() { ctx2.saveSettingsDebounced(); }

    function getSummaryPrompts() { return cfg.prompts; }

    let sumVersions = [];
    let sumViewIdx = -1;
    let sumCurrentPromptIdx = 0;
    let sumGenerating = false;
    let sumApiSource = cfg.apiSource === "profile" && cfg.connectionProfileId ? "profile:" + cfg.connectionProfileId : "main";

    // ── 설정 패널 마운트 ──
    function mountSettings() {
        const settingsHtml = `
        <div class="rt-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>📝 Replace & Summary Tool</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="rt-settings-section">
                        <h4>🔌 API 설정</h4>
                        <div class="rt-settings-row">
                            <label>API 소스:</label>
                            <select id="rt-cfg-api" class="rt-cfg-select"></select>
                        </div>
                    </div>
                    <hr/>
                    <div class="rt-settings-section">
                        <h4>📖 요약 프롬프트 1: 현재 스토리 아크</h4>
                        <textarea id="rt-cfg-prompt-0" class="rt-cfg-textarea" rows="5"></textarea>
                        <button class="menu_button rt-cfg-reset" data-idx="0">초기화</button>
                    </div>
                    <div class="rt-settings-section">
                        <h4>📚 요약 프롬프트 2: 전체 스토리 아크</h4>
                        <textarea id="rt-cfg-prompt-1" class="rt-cfg-textarea" rows="5"></textarea>
                        <button class="menu_button rt-cfg-reset" data-idx="1">초기화</button>
                    </div>
                    <div class="rt-settings-section">
                        <h4>📋 요약 프롬프트 3: 현재 상태 정리</h4>
                        <textarea id="rt-cfg-prompt-2" class="rt-cfg-textarea" rows="5"></textarea>
                        <button class="menu_button rt-cfg-reset" data-idx="2">초기화</button>
                    </div>
                    <hr/>
                    <div class="rt-settings-section">
                        <h4>🗑️ 캐시</h4>
                        <button class="menu_button" id="rt-cfg-cache-clear">요약 캐시 초기화</button>
                    </div>
                </div>
            </div>
        </div>`;

        $("#extensions_settings2").append(settingsHtml);

        // API 소스 드롭다운
        const apiSel = $("#rt-cfg-api");
        apiSel.append('<option value="main">Main API</option>');
        getProfiles().forEach(p => {
            const id = p.id || p.profileId || "";
            const name = p.name || p.profileName || id;
            if (id) apiSel.append(`<option value="profile:${id}">${esc(name)}</option>`);
        });
        const curVal = cfg.apiSource === "profile" && cfg.connectionProfileId ? "profile:" + cfg.connectionProfileId : "main";
        apiSel.val(curVal);
        apiSel.on("change", function () {
            const val = $(this).val();
            if (val === "main") { cfg.apiSource = "main"; cfg.connectionProfileId = ""; }
            else { cfg.apiSource = "profile"; cfg.connectionProfileId = val.replace("profile:", ""); }
            sumApiSource = val;
            persist();
        });

        // 프롬프트 텍스트에어리어
        for (let i = 0; i < 3; i++) {
            const ta = $(`#rt-cfg-prompt-${i}`);
            ta.val(cfg.prompts[i].prompt);
            ta.on("change", function () {
                cfg.prompts[i].prompt = $(this).val();
                persist();
            });
        }

        // 초기화 버튼
        $(".rt-cfg-reset").on("click", function () {
            const idx = parseInt($(this).data("idx"), 10);
            if (!confirm(`프롬프트 ${idx + 1}을 기본값으로 초기화할까요?`)) return;
            cfg.prompts[idx].prompt = DEFAULT_PROMPTS[idx].prompt;
            $(`#rt-cfg-prompt-${idx}`).val(DEFAULT_PROMPTS[idx].prompt);
            persist();
            if (typeof toastr !== "undefined") toastr.success("프롬프트 초기화됨");
        });

        // 캐시 초기화
        $("#rt-cfg-cache-clear").on("click", function () {
            if (!sumVersions.length) { if (typeof toastr !== "undefined") toastr.info("캐시가 없습니다."); return; }
            if (!confirm(`요약 캐시 ${sumVersions.length}건을 삭제할까요?`)) return;
            sumVersions = []; sumViewIdx = -1;
            removeSumBlock();
            if (typeof toastr !== "undefined") toastr.success("캐시 초기화됨");
        });
    }

    mountSettings();

    function esc(s) { const d=document.createElement("span");d.textContent=s;return d.innerHTML; }

    // ── 블록 관리 ──
    function removeSumBlock() { $("#sum-block").remove(); }
    function scrollToSumBlock() { const el=document.getElementById("sum-block"); if(el) el.scrollIntoView({behavior:"smooth",block:"end"}); }

    // ── API 프로필 목록 ──
    function getProfiles() {
        try {
            const ctx=getContext(); const cmrs=ctx.ConnectionManagerRequestService; let profiles=[];
            if(cmrs){ if(typeof cmrs.getConnectionProfiles==="function")profiles=cmrs.getConnectionProfiles()||[]; else if(typeof cmrs.getAllProfiles==="function")profiles=cmrs.getAllProfiles()||[]; else if(typeof cmrs.getProfiles==="function")profiles=cmrs.getProfiles()||[];
                if(!profiles.length){const s=ctx.extensionSettings?.connectionManager?.profiles||ctx.extensionSettings?.ConnectionManager?.profiles;if(Array.isArray(s))profiles=s;else if(s&&typeof s==="object")profiles=Object.values(s);} }
            return profiles;
        } catch(e) { return []; }
    }

    function buildApiOptions() {
        let html='<option value="main">Main API</option>';
        getProfiles().forEach(p => { const id=p.id||p.profileId||"",name=p.name||p.profileName||id; if(id) html+=`<option value="profile:${id}">${esc(name)}</option>`; });
        return html;
    }

    // ── 컨텍스트 수집 ──
    function getPersona() { try{const pu=window.power_user||getContext().power_user;const ua=window.user_avatar||getContext().user_avatar;if(!pu||!ua)return"";let s="User/Persona: "+(pu.personas?.[ua]||pu.name||"User")+"\n";const d=pu.persona_descriptions?.[ua];if(d?.description)s+="\nPersona Description:\n"+d.description+"\n";else if(pu.persona_description)s+="\nPersona Description:\n"+pu.persona_description+"\n";return s.trim();}catch{return"";} }
    function getCharacter() { try{const c=getContext();const ch=c.characters?.[c.characterId];if(!ch)return"";const d=ch.data||ch;let s="";if(ch.name)s+="Character: "+ch.name+"\n";if(d.description)s+="\nDescription:\n"+d.description+"\n";if(d.personality)s+="\nPersonality:\n"+d.personality+"\n";if(d.scenario)s+="\nScenario:\n"+d.scenario+"\n";return s.trim();}catch{return"";} }
    function gatherPlainContext(max) { const ctx=getContext();if(!ctx?.chat?.length)return"";let t="";const p=getPersona();if(p)t+="=== PERSONA ===\n"+p+"\n\n";const c=getCharacter();if(c)t+="=== CHARACTER ===\n"+c+"\n\n";t+="=== CONVERSATION ===\n";const start=Math.max(0,ctx.chat.length-(max||30));for(let i=start;i<ctx.chat.length;i++){const m=ctx.chat[i];if(!m)continue;t+=(m.is_user?(m.name||"User"):(m.name||"Character"))+": "+(m.extra?.display_text??m.mes)+"\n\n";}return t.trim(); }
    function gatherChatMessages(max) { const ctx=getContext();if(!ctx?.chat?.length)return[];const msgs=[];let sys="";const p=getPersona(),c=getCharacter();if(p)sys+=p;if(c)sys+=(sys?"\n\n":"")+c;if(sys)msgs.push({role:"system",content:sys});const start=Math.max(0,ctx.chat.length-(max||30));for(let i=start;i<ctx.chat.length;i++){const m=ctx.chat[i];if(!m)continue;msgs.push({role:m.is_user?"user":"assistant",content:m.extra?.display_text??m.mes});}return msgs; }

    // ── API 호출 ──
    async function callApi(promptText) {
        const ctx=getContext();
        if(sumApiSource==="main") {
            const{generateRaw}=ctx; if(!generateRaw)throw new Error("generateRaw not available");
            return await generateRaw({systemPrompt:gatherPlainContext(30),prompt:promptText,streaming:false});
        } else {
            const profileId=sumApiSource.replace("profile:",""); if(!profileId)throw new Error("프로필 ID 없음");
            if(!ctx.ConnectionManagerRequestService)throw new Error("Connection Manager 미로드");
            const msgs=gatherChatMessages(30); msgs.push({role:"user",content:promptText});
            const resp=await ctx.ConnectionManagerRequestService.sendRequest(profileId,msgs,8000,{stream:false,extractData:true,includePreset:false,includeInstruct:false}).catch(e=>{throw new Error("Profile 오류: "+e.message);});
            if(typeof resp==="string")return resp; if(resp?.choices?.[0]?.message){const m=resp.choices[0].message;return m.reasoning_content||m.content||"";}return resp?.content||resp?.message||"";
        }
    }

    // ── 복사 ──
    async function copyText(text) {
        if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(text);if(typeof toastr!=="undefined")toastr.success("복사 완료!","RT",{timeOut:1500});return;}catch(e){}}
        const ta=document.createElement("textarea");ta.value=text;ta.style.cssText="position:fixed;left:-9999px;";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");if(typeof toastr!=="undefined")toastr.success("복사 완료!","RT",{timeOut:1500});}catch(e){if(typeof toastr!=="undefined")toastr.error("복사 실패");}document.body.removeChild(ta);
    }

    // ── 타입 선택 블록 ──
    function showSelectBlock() {
        removeSumBlock();
        const block = $('<div id="sum-block" class="sum-block"></div>');
        const head = $('<div class="sum-block-head"></div>');
        head.append('<span class="sum-block-title">📝 요약</span>');
        const closeBtn=$('<button class="sum-head-btn" title="닫기">✕</button>');
        closeBtn.on("click",removeSumBlock);
        head.append(closeBtn);
        block.append(head);

        const body=$('<div class="sum-block-body"></div>');

        // API 선택
        const apiRow=$(`<div class="sum-api-row"><label class="sum-api-label">API:</label><select class="sum-api-select">${buildApiOptions()}</select></div>`);
        apiRow.find("select").val(sumApiSource).on("change",function(){
            sumApiSource=$(this).val();
            // 설정에도 저장
            if(sumApiSource==="main"){cfg.apiSource="main";cfg.connectionProfileId="";}
            else{cfg.apiSource="profile";cfg.connectionProfileId=sumApiSource.replace("profile:","");}
            persist();
        });
        body.append(apiRow);

        // 타입 선택 카드
        getSummaryPrompts().forEach((p,i)=>{
            const item=$(`<div class="sum-select-card" data-idx="${i}"><span>${p.label}</span></div>`);
            item.on("click",()=>{ startSummary(i); });
            body.append(item);
        });

        block.append(body);
        $("#chat").append(block);
        scrollToSumBlock();
    }

    // ── 로딩 블록 ──
    function showLoadingBlock(msg) {
        removeSumBlock();
        const block=$('<div id="sum-block" class="sum-block"></div>');
        block.html(`<div class="sum-block-head"><span class="sum-block-title">📝 요약</span></div><div class="sum-block-body"><div class="sum-loading-area"><div class="sum-dots"><span></span><span></span><span></span></div><span>${msg}</span></div></div>`);
        $("#chat").append(block);
        scrollToSumBlock();
    }

    // ── 결과 블록 ──
    function showResultBlock() {
        removeSumBlock();
        if(!sumVersions.length) return;

        const total=sumVersions.length;
        const idx=sumViewIdx;
        const text=sumVersions[idx];

        const block=$('<div id="sum-block" class="sum-block"></div>');

        // 헤더
        const head=$('<div class="sum-block-head"></div>');
        head.append('<span class="sum-block-title">📝 요약 결과</span>');
        const btns=$('<div class="sum-head-btns"></div>');

        // 네비게이션
        const nav=$('<div class="sum-nav"></div>');
        const prevBtn=$('<button class="sum-nav-btn" title="이전 버전">◀</button>');
        const navLabel=$(`<span class="sum-nav-label">${idx+1}/${total}</span>`);
        const nextBtn=$('<button class="sum-nav-btn" title="다음 버전">▶</button>');
        if(idx<=0) prevBtn.prop("disabled",true);
        if(idx>=total-1) nextBtn.prop("disabled",true);
        prevBtn.on("click",()=>{if(sumViewIdx>0){sumViewIdx--;showResultBlock();}});
        nextBtn.on("click",()=>{if(sumViewIdx<sumVersions.length-1){sumViewIdx++;showResultBlock();}});
        nav.append(prevBtn,navLabel,nextBtn);
        btns.append(nav);

        btns.append('<button class="sum-head-btn sum-do-back" title="타입 선택으로">↩️</button>');
        btns.append('<button class="sum-head-btn sum-do-regen" title="재생성">🔄</button>');
        btns.append('<button class="sum-head-btn sum-do-collapse" title="접기/펼치기">▲</button>');
        btns.append('<button class="sum-head-btn sum-do-close" title="닫기">✕</button>');
        head.append(btns);
        block.append(head);

        // 본문 영역
        const body=$('<div class="sum-block-body sum-result-area"></div>');

        // 결과 텍스트 / 에디터
        const display=$(`<div class="sum-result-text"></div>`);
        display.text(text);
        const editor=$(`<textarea class="sum-result-editor"></textarea>`);
        editor.val(text).hide();
        body.append(display,editor);

        // 액션 버튼
        const actions=$('<div class="sum-result-actions"></div>');
        const copyBtn=$('<button class="sum-act-btn">📋 복사</button>');
        const editBtn=$('<button class="sum-act-btn">✏️ 직접 수정</button>');
        const saveBtn=$('<button class="sum-act-btn sum-act-primary" style="display:none;">💾 저장</button>');
        const cancelBtn=$('<button class="sum-act-btn" style="display:none;">취소</button>');

        copyBtn.on("click",()=>{
            const t=editor.is(":visible")?editor.val():sumVersions[sumViewIdx];
            copyText(t);
        });
        editBtn.on("click",()=>{
            editor.val(sumVersions[sumViewIdx]).show().focus();
            display.hide(); editBtn.hide(); saveBtn.show(); cancelBtn.show();
        });
        saveBtn.on("click",()=>{
            sumVersions[sumViewIdx]=editor.val();
            display.text(editor.val()); editor.hide(); display.show();
            saveBtn.hide(); cancelBtn.hide(); editBtn.show();
            if(typeof toastr!=="undefined")toastr.success("저장됨","RT",{timeOut:1500});
        });
        cancelBtn.on("click",()=>{
            editor.hide(); display.show(); saveBtn.hide(); cancelBtn.hide(); editBtn.show();
        });

        actions.append(copyBtn,editBtn,saveBtn,cancelBtn);
        body.append(actions);

        // 수정 요청
        const revise=$(`<div class="sum-revise-row"><textarea class="sum-revise-input" placeholder="수정 방향을 입력하세요..." rows="2"></textarea><button class="sum-act-btn sum-act-primary sum-revise-send">📨 수정 요청</button></div>`);
        revise.find(".sum-revise-send").on("click",()=>{
            const dir=revise.find(".sum-revise-input").val().trim();
            if(!dir){if(typeof toastr!=="undefined")toastr.warning("수정 방향을 입력해주세요.");return;}
            reviseSummary(dir);
        });
        revise.find(".sum-revise-input").on("keydown",e=>{
            if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();revise.find(".sum-revise-send").click();}
        });
        body.append(revise);

        block.append(body);

        // 헤더 이벤트
        block.find(".sum-do-back").on("click",()=>showSelectBlock());
        block.find(".sum-do-regen").on("click",()=>{if(!sumGenerating)regenSummary();});
        block.find(".sum-do-collapse").on("click",function(){
            const area=block.find(".sum-result-area");
            area.slideToggle(200);
            $(this).text(area.is(":visible")?"▼":"▲");
        });
        block.find(".sum-do-close").on("click",removeSumBlock);

        $("#chat").append(block);
        scrollToSumBlock();
    }

    // ── 요약 실행 ──
    async function startSummary(promptIdx) {
        if(sumGenerating){if(typeof toastr!=="undefined")toastr.warning("생성 중입니다...");return;}
        const ctx=getContext();if(!ctx?.chat?.length){if(typeof toastr!=="undefined")toastr.warning("대화 내역이 없습니다.");return;}

        sumCurrentPromptIdx=promptIdx;
        sumGenerating=true;
        showLoadingBlock("⏳ 요약 생성 중...");

        try {
            let prompt=getSummaryPrompts()[promptIdx].prompt;
            if(ctx.substituteParams) prompt=ctx.substituteParams(prompt);
            const result=await callApi(prompt);
            if(!result?.trim()) throw new Error("빈 응답");
            sumVersions.push(result.trim());
            sumViewIdx=sumVersions.length-1;
            showResultBlock();
        } catch(e) {
            console.error("[RT] 요약 실패:",e);
            removeSumBlock();
            const block=$('<div id="sum-block" class="sum-block"></div>');
            block.html(`<div class="sum-block-head"><span class="sum-block-title">📝 요약</span><div class="sum-head-btns"><button class="sum-head-btn sum-fail-retry">다시 시도</button><button class="sum-head-btn sum-fail-close">✕</button></div></div><div class="sum-block-body"><div class="sum-fail-msg">❌ 요약 생성 실패: ${esc(e.message)}</div></div>`);
            block.find(".sum-fail-retry").on("click",()=>startSummary(promptIdx));
            block.find(".sum-fail-close").on("click",removeSumBlock);
            $("#chat").append(block); scrollToSumBlock();
        }
        sumGenerating=false;
    }

    async function regenSummary() {
        if(sumGenerating)return;
        const ctx=getContext();if(!ctx?.chat?.length)return;
        sumGenerating=true;

        // 결과 영역을 로딩으로 교체
        const area=$("#sum-block .sum-result-area");
        if(area.length) area.html('<div class="sum-loading-area"><div class="sum-dots"><span></span><span></span><span></span></div><span>⏳ 재생성 중...</span></div>');
        else showLoadingBlock("⏳ 재생성 중...");

        try {
            let prompt=getSummaryPrompts()[sumCurrentPromptIdx].prompt;
            if(ctx.substituteParams) prompt=ctx.substituteParams(prompt);
            const result=await callApi(prompt);
            if(!result?.trim()) throw new Error("빈 응답");
            sumVersions.push(result.trim());
            sumViewIdx=sumVersions.length-1;
            showResultBlock();
        } catch(e) {
            console.error("[RT] 재생성 실패:",e);
            if(typeof toastr!=="undefined")toastr.error("재생성 실패: "+e.message);
            if(sumVersions.length) showResultBlock();
        }
        sumGenerating=false;
    }

    async function reviseSummary(direction) {
        if(sumGenerating)return;
        if(!sumVersions.length)return;
        sumGenerating=true;

        const area=$("#sum-block .sum-result-area");
        if(area.length) area.html('<div class="sum-loading-area"><div class="sum-dots"><span></span><span></span><span></span></div><span>⏳ 수정 중...</span></div>');

        try {
            const currentText=sumVersions[sumViewIdx];
            const ctx=getContext();
            let editPrompt=`(OOC: RP 중단. 아래는 이전에 생성한 요약입니다:\n\n${currentText}\n\n위 요약을 다음 방향으로 수정해줘: ${direction}\n\n한글본, 영어본으로 각각 코드블럭에 넣어줘.\n**RP는 절대 이어가지 말 것.**)`;
            if(ctx.substituteParams) editPrompt=ctx.substituteParams(editPrompt);
            const result=await callApi(editPrompt);
            if(!result?.trim()) throw new Error("빈 응답");
            sumVersions.push(result.trim());
            sumViewIdx=sumVersions.length-1;
            showResultBlock();
        } catch(e) {
            console.error("[RT] 수정 실패:",e);
            if(typeof toastr!=="undefined")toastr.error("수정 실패: "+e.message);
            if(sumVersions.length) showResultBlock();
        }
        sumGenerating=false;
    }

    // ── 하단 바 버튼 ──
    const sumOpenBtn=document.createElement("div");
    sumOpenBtn.id="sum-open-btn";
    sumOpenBtn.className="list-group-item flex-container flexGap5 interactable";
    sumOpenBtn.title="요약";
    sumOpenBtn.innerHTML='<i class="fa-solid fa-file-lines"></i> 요약';
    sumOpenBtn.addEventListener("click",()=>{
        if(sumVersions.length>0){showResultBlock();return;}
        showSelectBlock();
    });

    const sdGen=document.getElementById("sd_gen");
    const extMenu=document.getElementById("extensionsMenu");
    if(sdGen?.parentNode) sdGen.parentNode.insertBefore(sumOpenBtn,sdGen.nextSibling);
    else if(extMenu) extMenu.appendChild(sumOpenBtn);
    else{const w=document.getElementById("data_bank_wand_container");if(w?.parentNode)w.parentNode.insertBefore(sumOpenBtn,w.nextSibling);else document.body.appendChild(sumOpenBtn);}

    console.log("[RT] 📝 요약 기능 활성화!");
    console.log("[RT] 로드 완료!");
});
