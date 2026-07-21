/* ============================================================
   Artivive course — shared logic across all pages.
   Reads which page it is on from <body data-page> / data-module.
   ============================================================ */
(function(){
  'use strict';

  var TOTAL_MODULES = 5;
  var PROGRESS_KEY = 'module-progress';
  var EMAIL_KEY = 'learner-email';

  var MODULE_TITLES = {
    1: 'Foundations',
    2: 'Trigger Images & Digital Layers',
    3: 'File Formats & Media Craft',
    4: 'Timeline: Animating Your Artwork',
    5: 'Sequences: Building Interactive Experiences'
  };

  /* ---- integration config (fill in to connect ActiveCampaign) ---- */
  var MAKE_WEBHOOK_URL = '';   // e.g. https://hook.us1.make.com/xxxxxxxxxxxxxxxxxxxx
  var AC_ACTID = '';           // e.g. 1234567
  var AC_EVENT_KEY = '';       // e.g. 93f120c55fa6caf9dabc1430d8b4232efead5dfe

  /* ------------------------------------------------------------------
     Storage abstraction.
     - In the Claude artifact preview, window.storage is available (async).
     - On a real hosted site, we fall back to localStorage (sync).
     - As a last resort, an in-memory object (progress won't persist).
     Everything is wrapped in Promises so callers can treat it uniformly.
  ------------------------------------------------------------------ */
  var mem = {};
  function hasWinStorage(){ return typeof window.storage !== 'undefined' && window.storage; }

  function storeGet(key){
    if(hasWinStorage()){
      return window.storage.get(key, false)
        .then(function(r){ return (r && r.value != null) ? r.value : null; })
        .catch(function(){ return null; });
    }
    try { return Promise.resolve(localStorage.getItem(key)); }
    catch(e){ return Promise.resolve(Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null); }
  }

  function storeSet(key, value){
    if(hasWinStorage()){
      return window.storage.set(key, value, false).catch(function(e){ console.error('storage.set failed', e); });
    }
    try { localStorage.setItem(key, value); return Promise.resolve(); }
    catch(e){ mem[key] = value; return Promise.resolve(); }
  }

  /* ---- shared mutable state ---- */
  var progress = { completed: [] };
  var email = '';

  /* =====================  INTEGRATIONS  ===================== */
  function isValidEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  function sendEvent(eventName, extra){
    if(!email) return; // no identified contact yet — nothing to attach to
    if(MAKE_WEBHOOK_URL){
      var payload = { event: eventName, email: email, course: 'Learning Artivive', timestamp: new Date().toISOString() };
      for(var k in extra){ if(extra.hasOwnProperty(k)) payload[k] = extra[k]; }
      fetch(MAKE_WEBHOOK_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      }).catch(function(e){ console.warn('Make.com webhook failed', e); });
    }
    if(AC_ACTID && AC_EVENT_KEY){
      var body = 'actid=' + encodeURIComponent(AC_ACTID) +
        '&key=' + encodeURIComponent(AC_EVENT_KEY) +
        '&event=' + encodeURIComponent(eventName) +
        '&eventdata=' + encodeURIComponent(JSON.stringify(extra || {})) +
        '&visit=' + encodeURIComponent(JSON.stringify({ email: email }));
      fetch('https://trackcmp.net/event', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body
      }).catch(function(e){ console.warn('ActiveCampaign event failed', e); });
    }
  }

  function trackModuleComplete(m){
    sendEvent('module_' + m + '_complete', { module: m, moduleTitle: MODULE_TITLES[m] || '' });
    if(m === TOTAL_MODULES) sendEvent('course_complete', {});
  }

  /* =====================  MOBILE MENU  ===================== */
  function initMenu(){
    var menuToggle = document.getElementById('menuToggle');
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('backdrop');
    if(!menuToggle || !sidebar || !backdrop) return;
    function close(){ sidebar.classList.remove('open'); backdrop.classList.remove('show'); }
    menuToggle.addEventListener('click', function(){
      sidebar.classList.toggle('open'); backdrop.classList.toggle('show');
    });
    backdrop.addEventListener('click', close);
    document.querySelectorAll('.sidebar a').forEach(function(a){ a.addEventListener('click', close); });
  }

  /* =====================  SIDEBAR STATE  ===================== */
  function currentModule(){
    var m = document.body.getAttribute('data-module');
    return m ? parseInt(m, 10) : 0;
  }

  function applySidebarState(){
    var cur = currentModule();
    for(var m = 1; m <= TOTAL_MODULES; m++){
      var group = document.getElementById('sidebar-group-' + m);
      if(!group) continue;
      var unlocked = (m === 1) || (progress.completed.indexOf(m - 1) > -1);
      var completed = progress.completed.indexOf(m) > -1;
      group.classList.toggle('locked', !unlocked);
      group.classList.toggle('completed', completed);
      group.classList.toggle('current', m === cur);
    }
    var progEl = document.getElementById('sidebarProgress');
    if(progEl) progEl.textContent = progress.completed.length + ' of ' + TOTAL_MODULES + ' modules complete';
  }

  /* =====================  INDEX: MODULE CARDS  ===================== */
  function applyCardState(){
    document.querySelectorAll('.module-card').forEach(function(card){
      var m = parseInt(card.getAttribute('data-module'), 10);
      var unlocked = (m === 1) || (progress.completed.indexOf(m - 1) > -1);
      var completed = progress.completed.indexOf(m) > -1;
      card.classList.toggle('locked', !unlocked);
      card.classList.toggle('done', completed);
      var status = card.querySelector('.mc-status-text');
      if(status){
        status.textContent = completed ? 'Completed' : (unlocked ? 'Start module' : 'Locked');
      }
    });
  }

  /* =====================  MODULE PAGE STATE  ===================== */
  function applyModulePageState(){
    var m = currentModule();
    if(!m) return;
    var block = document.getElementById('module-' + m);
    if(!block) return;
    var unlocked = (m === 1) || (progress.completed.indexOf(m - 1) > -1);
    var completed = progress.completed.indexOf(m) > -1;
    block.classList.toggle('is-locked', !unlocked);
    block.classList.toggle('is-completed', completed);

    // prev/next nav lock: next is available only once this module is complete
    var nextLink = document.querySelector('.page-nav a.next');
    if(nextLink && nextLink.hasAttribute('data-requires-complete')){
      nextLink.classList.toggle('locked', !completed);
    }
  }

  /* =====================  PROGRESS I/O  ===================== */
  function loadProgress(){
    return storeGet(PROGRESS_KEY).then(function(val){
      if(val){
        try{
          var parsed = JSON.parse(val);
          if(parsed && Array.isArray(parsed.completed)) progress = parsed;
        }catch(e){ /* keep default */ }
      }
    });
  }

  function saveProgress(){ return storeSet(PROGRESS_KEY, JSON.stringify(progress)); }

  function completeModule(m){
    if(progress.completed.indexOf(m) === -1){
      progress.completed.push(m);
      saveProgress();
    }
    applySidebarState();
    applyModulePageState();
    applyCardState();
    trackModuleComplete(m);
  }

  function resetProgress(){
    progress = { completed: [] };
    saveProgress();
    applySidebarState();
    applyModulePageState();
    applyCardState();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* =====================  EMAIL CAPTURE (index)  ===================== */
  function showSavedState(){
    var card = document.getElementById('saveProgress');
    var display = document.getElementById('savedEmailDisplay');
    if(!card) return;
    card.classList.add('is-saved');
    card.classList.remove('has-error');
    if(display) display.textContent = email;
  }
  function showFormState(){
    var card = document.getElementById('saveProgress');
    var input = document.getElementById('saveProgressEmail');
    if(!card) return;
    card.classList.remove('is-saved');
    if(input) input.value = email;
  }
  function initEmailCapture(){
    var saveBtn = document.getElementById('saveProgressBtn');
    var emailInput = document.getElementById('saveProgressEmail');
    var changeLink = document.getElementById('changeEmailLink');
    var card = document.getElementById('saveProgress');
    if(saveBtn && emailInput){
      saveBtn.addEventListener('click', function(){
        var value = emailInput.value.trim();
        if(!isValidEmail(value)){ if(card) card.classList.add('has-error'); return; }
        email = value;
        storeSet(EMAIL_KEY, email);
        showSavedState();
        sendEvent('email_captured', {});
      });
    }
    if(changeLink){
      changeLink.addEventListener('click', function(e){ e.preventDefault(); showFormState(); });
    }
  }

  /* =====================  SCROLL SPY (within a page)  ===================== */
  function initScrollSpy(){
    var lessons = document.querySelectorAll('.lesson[id]');
    if(!lessons.length || !('IntersectionObserver' in window)) return;
    var links = document.querySelectorAll('.sidebar-group a');
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          links.forEach(function(l){ l.classList.remove('active'); });
          var link = document.querySelector('.sidebar-group a[href$="#' + entry.target.id + '"]');
          if(link) link.classList.add('active');
        }
      });
    }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });
    lessons.forEach(function(l){ observer.observe(l); });
  }

  /* =====================  COMMON WIRING  ===================== */
  function initButtons(){
    document.querySelectorAll('.btn-complete').forEach(function(btn){
      btn.addEventListener('click', function(){
        completeModule(parseInt(btn.getAttribute('data-module'), 10));
      });
    });
    var resetBtn = document.getElementById('resetProgressBtn');
    if(resetBtn){
      resetBtn.addEventListener('click', function(e){ e.preventDefault(); resetProgress(); });
    }
  }

  /* =====================  BOOT  ===================== */
  document.addEventListener('DOMContentLoaded', function(){
    initMenu();
    initButtons();
    initScrollSpy();
    initEmailCapture();

    // load persisted state, then paint
    Promise.all([
      loadProgress(),
      storeGet(EMAIL_KEY).then(function(v){ if(v){ email = v; } })
    ]).then(function(){
      applySidebarState();
      applyModulePageState();
      applyCardState();
      if(email && document.getElementById('saveProgress')) showSavedState();
    });
  });

  // expose for any inline needs / debugging
  window.CourseApp = { sendEvent: sendEvent, trackModuleComplete: trackModuleComplete };
})();