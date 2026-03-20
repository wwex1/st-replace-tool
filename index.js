// ═══════════════════════════════════════════════════════
// Replace Tool + Translate - 텍스트 치환 & 번역 (SillyTavern Extension)
// ═══════════════════════════════════════════════════════

const MODULE_NAME = "st-replace-tool";

const TR_DEFAULTS = {
    trEnabled: true,
    kwEnabled: true,
    rtEnabled: true,
    trApiSource: 'main',
    trConnectionProfileId: '',
    trDirection: 'ko2en',
};

jQuery(async () => {
    console.log("[Replace Tool] 확장프로그램 로딩...");

    const { getContext } = SillyTavern;

    // ─── 설정 ───
    function getSettings() {
        const { extensionSettings } = getContext();
        if (!extensionSettings[MODULE_NAME]) {
            extensionSettings[MODULE_NAME] = {};
        }
        const s = extensionSettings[MODULE_NAME];
        for (const [k, v] of Object.entries(TR_DEFAULTS)) {
            if (s[k] === undefined) s[k] = v;
        }
        return s;
    }
    function persist() { getContext().saveSettingsDebounced(); }

    const settings = getSettings();

    // ─── 복사 유틸 ───
    async function copyToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            try { await navigator.clipboard.writeText(text); return true; }
            catch (e) { console.log(`[${MODULE_NAME}] clipboard API failed:`, e); }
        }
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            if (ok) return true;
        } catch (e) { console.log(`[${MODULE_NAME}] textarea fallback failed:`, e); }
        return false;
    }

    // ─── Connection Profile 탐지 ───
    function discoverProfiles() {
        const ctx = getContext();
        const cmrs = ctx.ConnectionManagerRequestService;
        if (!cmrs) return [];

        const knownMethods = ['getConnectionProfiles', 'getAllProfiles', 'getProfiles', 'listProfiles'];
        for (const m of knownMethods) {
            if (typeof cmrs[m] === 'function') {
                try {
                    const result = cmrs[m]();
                    if (Array.isArray(result) && result.length) return result;
                } catch {}
            }
        }

        try {
            const proto = Object.getPrototypeOf(cmrs);
            const dynamicMethods = Object.getOwnPropertyNames(proto)
                .filter(k => typeof cmrs[k] === 'function' && /rofile/i.test(k) && !knownMethods.includes(k));
            for (const m of dynamicMethods) {
                try {
                    const result = cmrs[m]();
                    if (Array.isArray(result) && result.length) return result;
                } catch {}
            }
        } catch {}

        const paths = [
            ctx.extensionSettings?.connectionManager?.profiles,
            ctx.extensionSettings?.ConnectionManager?.profiles,
            ctx.extensionSettings?.connection_manager?.profiles,
        ];
        for (const s of paths) {
            if (!s) continue;
            const arr = Array.isArray(s) ? s : Object.values(s);
            if (arr.length) return arr;
        }
        return [];
    }

    function getProfileId(p) { return p.id || p.profileId || p.profile_id || p.uuid || ''; }
    function getProfileName(p) { return p.name || p.profileName || p.profile_name || p.displayName || getProfileId(p); }

    async function sendProfileRequest(msgs, maxTokens) {
        const ctx = getContext();
        const cmrs = ctx.ConnectionManagerRequestService;
        if (!cmrs) throw new Error('Connection Manager 미로드');

        const optionSets = [
            { stream: false, extractData: true, includePreset: false, includeInstruct: false },
            { streaming: false, extractData: true, includePreset: false, includeInstruct: false },
            { stream: false, extractData: true },
            { streaming: false },
        ];

        let lastError = null;
        for (const opts of optionSets) {
            try {
                const resp = await cmrs.sendRequest(settings.trConnectionProfileId, msgs, maxTokens, opts);
                if (typeof resp === 'string') return resp;
                if (resp?.choices?.[0]?.message) {
                    const m = resp.choices[0].message;
                    return m.reasoning_content || m.content || '';
                }
                if (resp?.content) return resp.content;
                if (resp?.message) return resp.message;
                lastError = new Error('응답 형식 인식 실패');
            } catch (e) {
                lastError = e;
            }
        }
        throw new Error(`Profile 오류: ${lastError?.message || '알 수 없는 오류'}`);
    }

    // ═════════════════════════════════════════════
    // 🔄 파트 1: Replace Tool (텍스트 치환)
    // ═════════════════════════════════════════════

    const rtPopupHtml = `
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
                    <input type="checkbox" id="rt-cut-infoblock" />
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
    $("body").append(rtPopupHtml);

    const rtBgEl = document.getElementById("rt-bg");
    const rtPopupEl = document.getElementById("rt-popup");
    const rulesEl = document.getElementById("rt-rules");
    const previewEl = document.getElementById("rt-preview");
    const badgeEl = document.getElementById("rt-msg-badge");

    let currentMesId = null;

    function addRule(findVal, replaceVal) {
        const rule = document.createElement("div");
        rule.className = "rt-rule";
        rule.innerHTML = `
            <textarea class="rt-find" placeholder="찾을 텍스트" rows="1">${findVal || ""}</textarea>
            <textarea class="rt-replace" placeholder="바꿀 텍스트 (비우면 삭제)" rows="1">${replaceVal || ""}</textarea>
            <div class="rt-rule-del" title="규칙 삭제">✕</div>
        `;
        rule.querySelector(".rt-find").addEventListener("input", updatePreview);
        rule.querySelector(".rt-replace").addEventListener("input", updatePreview);
        rule.querySelector(".rt-rule-del").addEventListener("click", () => {
            rule.remove();
            updatePreview();
        });
        rulesEl.appendChild(rule);
    }

    function getRules() {
        const rules = [];
        rulesEl.querySelectorAll(".rt-rule").forEach(el => {
            const find = el.querySelector(".rt-find").value;
            const replace = el.querySelector(".rt-replace").value;
            if (find) rules.push({ find, replace });
        });
        return rules;
    }

    function applyRules(text, rules) {
        const cutInfoblock = document.getElementById("rt-cut-infoblock").checked;
        let target = text, suffix = "";
        if (cutInfoblock) {
            const idx = text.indexOf("<infoblock>");
            if (idx !== -1) { target = text.substring(0, idx); suffix = text.substring(idx); }
        }
        for (const r of rules) { target = target.split(r.find).join(r.replace); }
        return target + suffix;
    }

    function buildHighlightedPreview(text, rules) {
        const cutInfoblock = document.getElementById("rt-cut-infoblock").checked;
        let target = text, suffix = "";
        if (cutInfoblock) {
            const idx = text.indexOf("<infoblock>");
            if (idx !== -1) { target = text.substring(0, idx); suffix = text.substring(idx); }
        }
        const findTerms = rules.map(r => r.find).filter(f => f.length > 0);
        if (findTerms.length === 0) return escapeHtml(target) + escapeHtml(suffix);
        const escaped = findTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        const regex = new RegExp("(" + escaped.join("|") + ")", "g");
        const parts = target.split(regex);
        const findSet = new Set(findTerms);
        let html = "";
        for (const part of parts) {
            html += findSet.has(part) ? '<span class="rt-hl">' + escapeHtml(part) + "</span>" : escapeHtml(part);
        }
        return html + escapeHtml(suffix);
    }

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function getRawText(mesId) {
        try { const ctx = getContext(); if (ctx?.chat?.[mesId]) return ctx.chat[mesId].mes; } catch {}
        return null;
    }

    function updatePreview() {
        const raw = getRawText(currentMesId);
        if (!raw) return;
        previewEl.innerHTML = buildHighlightedPreview(raw, getRules());
    }

    function updateDOM(ctx, mesId, newText) {
        const el = document.querySelector('.mes[mesid="' + mesId + '"]');
        if (!el) return;
        const mt = el.querySelector(".mes_text");
        if (!mt) return;
        try {
            if (typeof ctx.messageFormatting === "function") {
                const c = ctx.chat[mesId];
                mt.innerHTML = ctx.messageFormatting(newText, c.name, c.is_system, c.is_user, mesId);
            } else { mt.innerHTML = newText.replace(/\n/g, "<br>"); }
        } catch { mt.innerHTML = newText.replace(/\n/g, "<br>"); }
    }

    function doSaveChat(ctx) {
        if (typeof ctx.saveChatDebounced === "function") ctx.saveChatDebounced();
        else if (typeof ctx.saveChat === "function") ctx.saveChat();
    }

    function rtPosPopup() { rtPopupEl.style.display = "flex"; }

    function openRtPopup(mesId) {
        currentMesId = Number(mesId);
        rulesEl.innerHTML = "";
        addRule();
        const raw = getRawText(currentMesId);
        previewEl.innerHTML = raw ? escapeHtml(raw) : "(텍스트 없음)";
        badgeEl.textContent = "#" + currentMesId;
        rtBgEl.classList.add("rt-show");
        rtPopupEl.classList.add("rt-show");
        rtPosPopup();
        setTimeout(rtPosPopup, 100);
    }

    function closeRtPopup() {
        rtBgEl.classList.remove("rt-show");
        rtPopupEl.classList.remove("rt-show");
        rtPopupEl.style.display = "none";
        currentMesId = null;
    }

    function executeReplace() {
        const ctx = getContext();
        if (!ctx?.chat || currentMesId === null) return;
        const msg = ctx.chat[currentMesId];
        if (!msg) return;
        const rules = getRules();
        if (rules.length === 0) { toastr.warning("치환 규칙을 입력해주세요."); return; }
        const newText = applyRules(msg.mes, rules);
        if (newText === msg.mes) { toastr.info("변경된 내용이 없습니다."); return; }
        ctx.chat[currentMesId].mes = newText;
        updateDOM(ctx, currentMesId, newText);
        doSaveChat(ctx);
        toastr.success("치환 완료! (" + rules.length + "개 규칙)", "Replace Tool", { timeOut: 2000 });
        closeRtPopup();
    }

    document.getElementById("rt-close").addEventListener("click", closeRtPopup);
    rtBgEl.addEventListener("click", closeRtPopup);
    document.getElementById("rt-add").addEventListener("click", () => addRule());
    document.getElementById("rt-exec").addEventListener("click", executeReplace);
    document.getElementById("rt-cut-infoblock").addEventListener("change", updatePreview);

    function upsertReplaceButtons() {
        document.querySelectorAll(".mes").forEach(mes => {
            const mesId = mes.getAttribute("mesid");
            if (!mesId || mes.querySelector(".rt-mes-btn")) return;
            const target = mes.querySelector(".extraMesButtons");
            if (!target) return;
            const btn = document.createElement("div");
            btn.className = "rt-mes-btn mes_button fa-solid fa-right-left";
            btn.title = "텍스트 치환";
            btn.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); openRtPopup(mesId); });
            target.prepend(btn);
        });
    }

    // 치환 버튼 표시/숨기기
    function updateRtButtonVisibility() {
        document.querySelectorAll('.rt-mes-btn').forEach(btn => {
            btn.style.display = settings.rtEnabled ? '' : 'none';
        });
    }

    const chat = document.getElementById("chat");
    if (chat) {
        const observer = new MutationObserver(() => {
            upsertReplaceButtons();
            updateRtButtonVisibility();
        });
        observer.observe(chat, { childList: true, subtree: true });
        upsertReplaceButtons();
        updateRtButtonVisibility();
    }

    console.log("[Replace Tool] 🔄 치환 기능 활성화!");

    // ═════════════════════════════════════════════
    // 🌐 파트 2: Translate + Keyword (간단 번역 & 키워드 추출)
    // ═════════════════════════════════════════════

    let trModalOpen = false;
    let trTranslating = false;
    let trBgEl = null;
    let trPopupEl = null;
    let trMode = 'keyword'; // 'translate' | 'keyword' — 키워드가 기본

    // ── API 호출 공통 ──
    async function callAPI(instruction) {
        if (settings.trApiSource === 'main') {
            const ctx = getContext();
            const { generateRaw } = ctx;
            if (!generateRaw) throw new Error('generateRaw not available');
            return await generateRaw({ systemPrompt: '', prompt: instruction, streaming: false });
        } else {
            const msgs = [{ role: 'user', content: instruction }];
            return await sendProfileRequest(msgs, 2000);
        }
    }

    // ── 번역 ──
    async function translate(text) {
        if (!text.trim()) throw new Error('텍스트를 입력하세요.');
        const isKo2En = settings.trDirection === 'ko2en';
        const instruction = isKo2En
            ? `Translate the following Korean text into modern, casual English. Use natural phrasing that sounds like how people actually talk or write today — not stiff or textbook-style. Keep the original tone and nuance. Output ONLY the translation, nothing else.\n\n${text}`
            : `다음 영어 텍스트를 자연스럽고 현대적인 한국어로 번역해. 딱딱한 번역체 말고, 실제로 사람들이 쓰는 자연스러운 표현으로. 원문의 톤과 뉘앙스를 유지해. 번역문만 출력해.\n\n${text}`;
        return await callAPI(instruction);
    }

    // ── 키워드 추출 ──
    async function extractKeywords(text) {
        if (!text.trim()) throw new Error('텍스트를 입력하세요.');
        const instruction = `Extract keywords from the following text for use as lorebook trigger keywords in a roleplay context.

Rules:
- Extract character names, emotions, traits, objects, places, actions, relationships, and any distinctive concepts
- Output exactly 2 lines:
  Line 1: Korean keywords separated by commas
  Line 2: English keywords separated by commas
- Each line should have the SAME keywords, just in different languages
- Keep keywords short (1-2 words each)
- Include both specific terms and broader category terms useful for triggering lorebook entries
- Output ONLY the two lines of keywords, nothing else

Text:
${text}`;
        return await callAPI(instruction);
    }

    // ── DOM 생성 (한 번만) ──
    function ensureTrDOM() {
        if (trBgEl) return;

        trBgEl = document.createElement('div');
        trBgEl.id = 'tr-bg';
        document.body.appendChild(trBgEl);

        trPopupEl = document.createElement('div');
        trPopupEl.id = 'tr-popup';

        const dirLabel = () => settings.trDirection === 'ko2en' ? '한국어 → English' : 'English → 한국어';
        const placeholder = () => {
            if (trMode === 'keyword') return '키워드를 추출할 텍스트를 입력하세요...';
            return settings.trDirection === 'ko2en' ? '한국어를 입력하세요...' : 'Enter English text...';
        };

        // 키워드 탭이 기본이므로 초기 상태 반영
        trPopupEl.innerHTML = `
            <div class="tr-header">
                <span class="tr-title">키워드 추출</span>
                <span class="tr-close" title="닫기">✕</span>
            </div>
            <div class="tr-mode-tabs">
                <div class="tr-mode-tab" data-mode="keyword">🔑 키워드</div>
                <div class="tr-mode-tab" data-mode="translate">🌐 간단 번역</div>
            </div>
            <div class="tr-translate-options" style="display:none;">
                <div class="tr-toggle">${dirLabel()}</div>
            </div>
            <textarea class="tr-input" placeholder="${placeholder()}" rows="4"></textarea>
            <div class="tr-btn-exec">키워드 추출</div>
            <div class="tr-result-wrap" style="display:none;">
                <div class="tr-result"></div>
                <div class="tr-copy" title="복사">📋 복사</div>
            </div>
            <div class="tr-kw-result-wrap" style="display:none;">
                <div class="tr-kw-row">
                    <span class="tr-kw-label">KO</span>
                    <div class="tr-kw-text" id="tr-kw-ko"></div>
                    <div class="tr-kw-copy" title="한국어 키워드 복사" data-target="ko">📋</div>
                </div>
                <div class="tr-kw-row">
                    <span class="tr-kw-label">EN</span>
                    <div class="tr-kw-text" id="tr-kw-en"></div>
                    <div class="tr-kw-copy" title="영어 키워드 복사" data-target="en">📋</div>
                </div>
            </div>
            <div class="tr-loading" style="display:none;">
                <div class="tr-dots"><span></span><span></span><span></span></div>
                <span class="tr-loading-text">키워드 추출 중...</span>
            </div>
        `;
        document.body.appendChild(trPopupEl);

        // 요소 참조
        const tabs = trPopupEl.querySelectorAll('.tr-mode-tab');
        const translateOptions = trPopupEl.querySelector('.tr-translate-options');
        const toggleBtn = trPopupEl.querySelector('.tr-toggle');
        const input = trPopupEl.querySelector('.tr-input');
        const execBtn = trPopupEl.querySelector('.tr-btn-exec');
        const resultWrap = trPopupEl.querySelector('.tr-result-wrap');
        const resultDiv = trPopupEl.querySelector('.tr-result');
        const copyBtn = trPopupEl.querySelector('.tr-copy');
        const kwResultWrap = trPopupEl.querySelector('.tr-kw-result-wrap');
        const kwKoEl = trPopupEl.querySelector('#tr-kw-ko');
        const kwEnEl = trPopupEl.querySelector('#tr-kw-en');
        const loading = trPopupEl.querySelector('.tr-loading');
        const loadingText = trPopupEl.querySelector('.tr-loading-text');
        const titleEl = trPopupEl.querySelector('.tr-title');

        // 탭 활성화 갱신 (비활성화된 기능 반영)
        function updateTabVisibility() {
            tabs.forEach(t => {
                if (t.dataset.mode === 'keyword') {
                    t.style.display = settings.kwEnabled ? '' : 'none';
                } else if (t.dataset.mode === 'translate') {
                    t.style.display = settings.trEnabled ? '' : 'none';
                }
            });
        }

        // 모드 전환
        function switchMode(mode) {
            trMode = mode;
            tabs.forEach(t => t.classList.toggle('tr-mode-active', t.dataset.mode === mode));
            if (mode === 'keyword') {
                translateOptions.style.display = 'none';
                execBtn.textContent = '키워드 추출';
                titleEl.textContent = '키워드 추출';
            } else {
                translateOptions.style.display = '';
                execBtn.textContent = '번역';
                titleEl.textContent = '간단 번역';
            }
            input.placeholder = placeholder();
            resultWrap.style.display = 'none';
            resultDiv.textContent = '';
            kwResultWrap.style.display = 'none';
            kwKoEl.textContent = '';
            kwEnEl.textContent = '';
        }

        tabs.forEach(tab => {
            tab.addEventListener('click', () => switchMode(tab.dataset.mode));
        });

        // 초기 탭 활성화 (키워드 기본)
        updateTabVisibility();
        switchMode('keyword');

        // 닫기
        trBgEl.addEventListener('click', closeTrModal);
        trBgEl.addEventListener('touchend', (e) => { e.preventDefault(); closeTrModal(); });
        trPopupEl.querySelector('.tr-close').addEventListener('click', closeTrModal);

        // 방향 토글
        toggleBtn.addEventListener('click', () => {
            settings.trDirection = settings.trDirection === 'ko2en' ? 'en2ko' : 'ko2en';
            persist();
            toggleBtn.textContent = dirLabel();
            input.placeholder = placeholder();
        });

        // 실행 버튼
        execBtn.addEventListener('click', async () => {
            if (trTranslating) return;
            const text = input.value.trim();
            if (!text) { toastr.warning('텍스트를 입력하세요.'); return; }
            if (settings.trApiSource === 'profile' && !settings.trConnectionProfileId) {
                toastr.warning('Connection Profile을 선택하세요.'); return;
            }

            trTranslating = true;
            resultWrap.style.display = 'none';
            loadingText.textContent = trMode === 'keyword' ? '키워드 추출 중...' : '번역 중...';
            loading.style.display = 'flex';
            trPosPopup();

            try {
                const result = trMode === 'keyword' ? await extractKeywords(text) : await translate(text);
                const cleaned = result?.trim() || '';
                if (!cleaned) throw new Error('빈 응답');

                if (trMode === 'keyword') {
                    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
                    kwKoEl.textContent = lines[0] || '';
                    kwEnEl.textContent = lines[1] || lines[0] || '';
                    kwResultWrap.style.display = 'flex';
                    resultWrap.style.display = 'none';
                } else {
                    resultDiv.textContent = cleaned;
                    resultWrap.style.display = 'flex';
                    kwResultWrap.style.display = 'none';
                }
            } catch (err) {
                toastr.error(`${trMode === 'keyword' ? '키워드 추출' : '번역'} 실패: ${err.message}`);
            } finally {
                loading.style.display = 'none';
                trTranslating = false;
                trPosPopup();
            }
        });

        // 키보드
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); execBtn.click(); }
            if (e.key === 'Escape') { e.preventDefault(); closeTrModal(); }
        });

        // 복사
        copyBtn.addEventListener('click', async () => {
            const ok = await copyToClipboard(resultDiv.textContent);
            if (ok) toastr.success('복사됨');
        });

        // 키워드 줄별 복사
        trPopupEl.querySelectorAll('.tr-kw-copy').forEach(btn => {
            btn.addEventListener('click', async () => {
                const target = btn.dataset.target;
                const text = target === 'ko' ? kwKoEl.textContent : kwEnEl.textContent;
                if (!text) return;
                const ok = await copyToClipboard(text);
                if (ok) toastr.success(target === 'ko' ? '한국어 키워드 복사됨' : '영어 키워드 복사됨');
            });
        });

        // viewport
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => { if (trModalOpen) trPosPopup(); });
            window.visualViewport.addEventListener('scroll', () => { if (trModalOpen) trPosPopup(); });
        }

        // updateTabVisibility를 외부에서 호출 가능하게 저장
        trPopupEl._updateTabVisibility = updateTabVisibility;
        trPopupEl._switchMode = switchMode;
    }

    function trPosPopup() {
        if (!trPopupEl) return;
        const vv = window.visualViewport;
        const vH = vv ? vv.height : window.innerHeight;
        const vT = vv ? vv.offsetTop : 0;
        const vW = vv ? vv.width : window.innerWidth;

        trPopupEl.style.display = 'flex';
        trPopupEl.style.visibility = 'hidden';
        trPopupEl.style.transform = 'none';
        const pH = trPopupEl.offsetHeight;
        const pW = trPopupEl.offsetWidth;
        trPopupEl.style.visibility = 'visible';

        trPopupEl.style.top = (vT + Math.max(10, (vH - pH) / 2)) + 'px';
        trPopupEl.style.left = Math.max(5, (vW - pW) / 2) + 'px';
    }

    function openTrModal() {
        if (trModalOpen) return;
        // 둘 다 꺼져있으면 열지 않음
        if (!settings.kwEnabled && !settings.trEnabled) return;
        trModalOpen = true;
        ensureTrDOM();

        // 탭 가시성 갱신
        if (trPopupEl._updateTabVisibility) trPopupEl._updateTabVisibility();

        // 기본 모드 결정: 키워드 우선, 키워드 꺼져있으면 번역
        const defaultMode = settings.kwEnabled ? 'keyword' : 'translate';
        if (trPopupEl._switchMode) trPopupEl._switchMode(defaultMode);

        const resultWrap = trPopupEl.querySelector('.tr-result-wrap');
        const loading = trPopupEl.querySelector('.tr-loading');
        resultWrap.style.display = 'none';
        loading.style.display = 'none';

        trBgEl.classList.add('tr-show');
        trPopupEl.classList.add('tr-show');
        trPosPopup();
        setTimeout(trPosPopup, 50);
        setTimeout(() => trPopupEl.querySelector('.tr-input').focus(), 100);
    }

    function closeTrModal() {
        if (!trModalOpen) return;
        trModalOpen = false;
        if (trBgEl) trBgEl.classList.remove('tr-show');
        if (trPopupEl) {
            trPopupEl.classList.remove('tr-show');
            trPopupEl.style.display = 'none';
            const input = trPopupEl.querySelector('.tr-input');
            const resultWrap = trPopupEl.querySelector('.tr-result-wrap');
            const resultDiv = trPopupEl.querySelector('.tr-result');
            if (input) input.value = '';
            if (resultDiv) resultDiv.textContent = '';
            if (resultWrap) resultWrap.style.display = 'none';
            const kwWrap = trPopupEl.querySelector('.tr-kw-result-wrap');
            const kwKo = trPopupEl.querySelector('#tr-kw-ko');
            const kwEn = trPopupEl.querySelector('#tr-kw-en');
            if (kwKo) kwKo.textContent = '';
            if (kwEn) kwEn.textContent = '';
            if (kwWrap) kwWrap.style.display = 'none';
        }
    }

    // ── 확장 메뉴 버튼 (키워드로 변경) ──
    function updateTrMenuVisibility() {
        const btn = document.getElementById('tr_menu_btn');
        // 키워드 또는 번역 중 하나라도 켜져있으면 표시
        if (btn) btn.style.display = (settings.kwEnabled || settings.trEnabled) ? '' : 'none';
    }

    const trMenuBtn = document.createElement('div');
    trMenuBtn.id = 'tr_menu_btn';
    trMenuBtn.className = 'list-group-item flex-container flexGap5 interactable';
    trMenuBtn.title = '키워드';
    trMenuBtn.innerHTML = '<i class="fa-solid fa-key"></i> 키워드';
    trMenuBtn.style.display = (settings.kwEnabled || settings.trEnabled) ? '' : 'none';
    trMenuBtn.addEventListener('click', () => {
        $('#extensionsMenu').hide();
        openTrModal();
    });

    const extMenu = document.getElementById('extensionsMenu');
    if (extMenu) {
        extMenu.appendChild(trMenuBtn);
    } else {
        const obs = new MutationObserver((_, o) => {
            const m = document.getElementById('extensionsMenu');
            if (m) { m.appendChild(trMenuBtn); o.disconnect(); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    console.log("[Replace Tool] 🌐 번역 기능 활성화!");

    // ═════════════════════════════════════════════
    // ⚙️ 파트 3: 설정 패널
    // ═════════════════════════════════════════════

    const settingsHtml = `
    <div class="rt-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Replace Tool + 번역</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <hr />
                <h4 style="margin:6px 0 4px;">기능 활성화</h4>
                <label class="checkbox_label">
                    <input type="checkbox" id="rt-setting-rt-enabled" />
                    <span>🔄 텍스트 치환</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="rt-setting-kw-enabled" />
                    <span>🔑 키워드 추출</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="rt-setting-tr-enabled" />
                    <span>🌐 간단 번역</span>
                </label>
                <hr />
                <h4 style="margin:6px 0 4px;">API 설정</h4>
                <label style="display:block;font-size:0.9em;">API 소스</label>
                <select id="rt-tr-source" class="text_pole" style="width:100%;margin-top:4px;"></select>
            </div>
        </div>
    </div>`;
    $("#extensions_settings2").append(settingsHtml);

    // 치환 활성화 체크박스
    const rtEnabledEl = document.getElementById('rt-setting-rt-enabled');
    rtEnabledEl.checked = settings.rtEnabled;
    rtEnabledEl.addEventListener('change', function () {
        settings.rtEnabled = this.checked;
        persist();
        updateRtButtonVisibility();
        toastr.info(settings.rtEnabled ? '치환 활성화됨' : '치환 비활성화됨');
    });

    // 키워드 활성화 체크박스
    const kwEnabledEl = document.getElementById('rt-setting-kw-enabled');
    kwEnabledEl.checked = settings.kwEnabled;
    kwEnabledEl.addEventListener('change', function () {
        settings.kwEnabled = this.checked;
        persist();
        updateTrMenuVisibility();
        toastr.info(settings.kwEnabled ? '키워드 추출 활성화됨' : '키워드 추출 비활성화됨');
    });

    // 번역 활성화 체크박스
    const trEnabledEl = document.getElementById('rt-setting-tr-enabled');
    trEnabledEl.checked = settings.trEnabled;
    trEnabledEl.addEventListener('change', function () {
        settings.trEnabled = this.checked;
        persist();
        updateTrMenuVisibility();
        toastr.info(settings.trEnabled ? '간단 번역 활성화됨' : '간단 번역 비활성화됨');
    });

    // API 소스 드롭다운
    const trSourceEl = document.getElementById('rt-tr-source');
    trSourceEl.innerHTML = '<option value="main">Main API</option>';
    try {
        const profiles = discoverProfiles();
        profiles.forEach(p => {
            const id = getProfileId(p);
            const name = getProfileName(p);
            if (id) trSourceEl.insertAdjacentHTML('beforeend', `<option value="profile:${id}">${name}</option>`);
        });
    } catch {}

    const currentSourceVal = settings.trApiSource === 'profile' && settings.trConnectionProfileId
        ? `profile:${settings.trConnectionProfileId}` : 'main';
    trSourceEl.value = currentSourceVal;
    trSourceEl.addEventListener('change', function () {
        const val = this.value;
        if (val === 'main') { settings.trApiSource = 'main'; settings.trConnectionProfileId = ''; }
        else { settings.trApiSource = 'profile'; settings.trConnectionProfileId = val.replace('profile:', ''); }
        persist();
    });

    console.log("[Replace Tool] 로드 완료!");
});
