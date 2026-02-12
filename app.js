// MessageHub SaaS - Logica de Aplicacion

// ========== ESTADO GLOBAL ==========
let currentUser = null;
let currentUserData = null;
let currentOrganization = null;
let selectedRole = null;
let appNotifications = [];
let teamMembers = [];

// ========== FUNCIONES DE NOTIFICACION (MODAL) ==========

function showNotification(title, message, type = 'error') {
    const overlay = document.getElementById('notificationOverlay');
    const box = document.getElementById('notificationBox');
    const iconEl = document.getElementById('notificationIcon');
    const titleEl = document.getElementById('notificationTitle');
    const messageEl = document.getElementById('notificationMessage');

    if (type === 'error') iconEl.textContent = '⚠️';
    else if (type === 'success') iconEl.textContent = '✅';
    else if (type === 'warning') iconEl.textContent = '⚠️';
    else iconEl.textContent = 'ℹ️';

    titleEl.textContent = title;
    messageEl.textContent = message;
    box.className = 'notification-box ' + type;
    overlay.classList.remove('hidden');
}

function closeNotification() {
    document.getElementById('notificationOverlay').classList.add('hidden');
}

function getFirebaseAuthErrorMessage(error) {
    const currentDomain = window.location.hostname || window.location.href;
    switch (error.code) {
        case 'auth/unauthorized-domain':
            return {
                title: 'Dominio no autorizado',
                message: `El dominio actual (${currentDomain}) no esta autorizado para inicio de sesion con OAuth.\n\nPara solucionarlo:\n1. Ve a Firebase Console\n2. Selecciona tu proyecto\n3. Ve a Authentication > Settings > Authorized domains\n4. Agrega: ${currentDomain}\n\nMientras tanto, usa email y contrasena.`
            };
        case 'auth/popup-blocked':
            return { title: 'Ventana bloqueada', message: 'El navegador bloqueo la ventana emergente. Permite ventanas emergentes para este sitio e intenta de nuevo.' };
        case 'auth/popup-closed-by-user':
            return { title: 'Inicio cancelado', message: 'Se cerro la ventana de inicio de sesion antes de completar el proceso.' };
        case 'auth/account-exists-with-different-credential':
            return { title: 'Cuenta existente', message: 'Ya existe una cuenta con este email usando otro metodo de inicio de sesion. Intenta con el metodo original.' };
        case 'auth/email-already-in-use':
            return { title: 'Correo en uso', message: 'Este correo electronico ya esta registrado. Intenta iniciar sesion o usa otro correo.' };
        case 'auth/weak-password':
            return { title: 'Contrasena debil', message: 'La contrasena debe tener al menos 6 caracteres.' };
        case 'auth/user-not-found':
            return { title: 'Usuario no encontrado', message: 'No existe una cuenta con este correo. Verifica tu correo o registrate.' };
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            return { title: 'Credenciales incorrectas', message: 'El correo o la contrasena son incorrectos. Intenta de nuevo.' };
        case 'auth/too-many-requests':
            return { title: 'Demasiados intentos', message: 'Has intentado demasiadas veces. Espera unos minutos antes de intentar de nuevo.' };
        case 'auth/cancelled-popup-request':
            return null;
        default:
            return { title: 'Error de autenticacion', message: error.message };
    }
}

// ========== FUNCIONES DE AUTENTICACION ==========

function switchAuthTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabs = document.querySelectorAll('.auth-tab');
    tabs.forEach(t => t.classList.remove('active'));
    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        tabs[0].classList.add('active');
    } else {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
        tabs[1].classList.add('active');
    }
}

// Login
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const btnText = document.getElementById('loginBtnText');
    const btn = document.getElementById('loginBtn');
    btnText.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;
    try {
        await window.firebaseAuth.signInWithEmailAndPassword(window.auth, email, password);
    } catch (error) {
        console.error('Error de login:', error);
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) showNotification(errorInfo.title, errorInfo.message, 'error');
        btnText.textContent = 'Iniciar Sesion';
        btn.disabled = false;
    }
});

// Registro
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const btnText = document.getElementById('registerBtnText');
    const btn = document.getElementById('registerBtn');
    if (password.length < 6) {
        showNotification('Contrasena muy corta', 'La contrasena debe tener al menos 6 caracteres.', 'warning');
        return;
    }
    btnText.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;
    try {
        const userCredential = await window.firebaseAuth.createUserWithEmailAndPassword(window.auth, email, password);
        await window.firebaseAuth.updateProfile(userCredential.user, { displayName: name });
        await window.firestore.setDoc(
            window.firestore.doc(window.db, 'users', userCredential.user.uid),
            { name: name, email: email, createdAt: window.firestore.serverTimestamp(), onboarded: false }
        );
    } catch (error) {
        console.error('Error de registro:', error);
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) showNotification(errorInfo.title, errorInfo.message, 'error');
        btnText.textContent = 'Crear Cuenta';
        btn.disabled = false;
    }
});

async function handleGoogleAuth() {
    try {
        const provider = new window.firebaseAuth.GoogleAuthProvider();
        const result = await window.firebaseAuth.signInWithPopup(window.auth, provider);
        const userDoc = await window.firestore.getDoc(window.firestore.doc(window.db, 'users', result.user.uid));
        if (!userDoc.exists()) {
            await window.firestore.setDoc(
                window.firestore.doc(window.db, 'users', result.user.uid),
                { name: result.user.displayName, email: result.user.email, createdAt: window.firestore.serverTimestamp(), onboarded: false }
            );
        }
    } catch (error) {
        console.error('Error Google auth:', error);
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) showNotification(errorInfo.title, errorInfo.message, 'error');
    }
}

async function handleFacebookAuth() {
    try {
        const provider = new window.firebaseAuth.FacebookAuthProvider();
        const result = await window.firebaseAuth.signInWithPopup(window.auth, provider);
        const userDoc = await window.firestore.getDoc(window.firestore.doc(window.db, 'users', result.user.uid));
        if (!userDoc.exists()) {
            await window.firestore.setDoc(
                window.firestore.doc(window.db, 'users', result.user.uid),
                { name: result.user.displayName, email: result.user.email, createdAt: window.firestore.serverTimestamp(), onboarded: false }
            );
        }
    } catch (error) {
        console.error('Error Facebook auth:', error);
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) showNotification(errorInfo.title, errorInfo.message, 'error');
    }
}

function handleForgotPassword() {
    const email = document.getElementById('loginEmail').value;
    if (!email) {
        showNotification('Correo requerido', 'Ingresa tu correo electronico en el campo de email y luego haz clic en "Olvidaste tu contrasena?".', 'info');
        return;
    }
    window.firebaseAuth.sendPasswordResetEmail(window.auth, email).then(() => {
        showNotification('Correo enviado', `Se ha enviado un enlace de recuperacion a ${email}. Revisa tu bandeja de entrada y carpeta de spam.`, 'success');
    }).catch((error) => {
        console.error('Error al enviar recuperacion:', error);
        if (error.code === 'auth/user-not-found') {
            showNotification('Usuario no encontrado', 'No existe una cuenta con este correo electronico.', 'error');
        } else {
            showNotification('Error', 'No se pudo enviar el correo de recuperacion. Intenta de nuevo.', 'error');
        }
    });
}

function handleLogout() {
    document.getElementById('logoutModal').classList.remove('hidden');
}

function closeLogoutModal() {
    document.getElementById('logoutModal').classList.add('hidden');
}

async function confirmLogout() {
    closeLogoutModal();
    try {
        await window.firebaseAuth.signOut(window.auth);
        currentUser = null;
        currentUserData = null;
        currentOrganization = null;
        appNotifications = [];
        teamMembers = [];
    } catch (error) {
        console.error('Error al cerrar sesion:', error);
        showNotification('Error', 'No se pudo cerrar sesion. Intenta de nuevo.', 'error');
    }
}

// ========== FUNCIONES DE ONBOARDING ==========

function selectRole(role) {
    selectedRole = role;
    const cards = document.querySelectorAll('.role-card');
    cards.forEach(card => card.classList.remove('selected'));
    event.target.closest('.role-card').classList.add('selected');
    document.getElementById('roleNextBtn').disabled = false;
}

function proceedToStep2() {
    document.getElementById('step1').classList.add('completed');
    document.getElementById('step2').classList.add('active');
    document.getElementById('onboardingStep1').classList.add('hidden');
    document.getElementById('onboardingStep2').classList.remove('hidden');
    if (selectedRole === 'gerente') {
        document.getElementById('adminSetup').classList.remove('hidden');
        document.getElementById('agentSetup').classList.add('hidden');
    } else {
        document.getElementById('adminSetup').classList.add('hidden');
        document.getElementById('agentSetup').classList.remove('hidden');
    }
}

function goBackToStep1() {
    document.getElementById('step1').classList.remove('completed');
    document.getElementById('step1').classList.add('active');
    document.getElementById('step2').classList.remove('active');
    document.getElementById('onboardingStep1').classList.remove('hidden');
    document.getElementById('onboardingStep2').classList.add('hidden');
    document.getElementById('adminSetup').classList.add('hidden');
    document.getElementById('agentSetup').classList.add('hidden');
    selectedRole = null;
    document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('roleNextBtn').disabled = true;
}

// Crear organizacion (Gerente)
document.getElementById('orgForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const orgName = document.getElementById('orgName').value.trim();
    const orgIndustry = document.getElementById('orgIndustry').value.trim();
    const btnText = document.getElementById('orgBtnText');
    if (!orgName) {
        showNotification('Campo requerido', 'Ingresa el nombre de tu organizacion.', 'warning');
        return;
    }
    btnText.innerHTML = '<span class="spinner"></span>';
    try {
        const orgId = generateOrgId();
        const inviteCode = generateInviteCode();
        await window.firestore.setDoc(
            window.firestore.doc(window.db, 'organizations', orgId),
            {
                name: orgName,
                industry: orgIndustry,
                ownerId: currentUser.uid,
                inviteCode: inviteCode,
                createdAt: window.firestore.serverTimestamp(),
                members: [currentUser.uid],
                integrations: { whatsapp: false, instagram: false, messenger: false }
            }
        );
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'users', currentUser.uid),
            { organizationId: orgId, role: 'gerente', onboarded: true }
        );
        showNotification(
            'Organizacion creada',
            `Tu organizacion "${orgName}" fue creada exitosamente.\n\nCodigo de invitacion: ${inviteCode}\n\nComparte este codigo con tu equipo para que se unan.`,
            'success'
        );
        await loadApp(currentUser.uid);
    } catch (error) {
        console.error('Error al crear organizacion:', error);
        showNotification('Error', 'No se pudo crear la organizacion: ' + error.message, 'error');
        btnText.textContent = 'Crear Organizacion';
    }
});

// Unirse a organizacion (Agente) - FIX del codigo de invitacion
document.getElementById('joinForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawCode = document.getElementById('inviteCode').value.trim();
    const inviteCode = rawCode.toUpperCase().replace(/\s/g, '');
    const btnText = document.getElementById('joinBtnText');

    if (!inviteCode || inviteCode.length < 5) {
        showNotification('Codigo invalido', 'Ingresa un codigo de invitacion valido (formato XXXXX-XXXXX).', 'warning');
        return;
    }

    btnText.innerHTML = '<span class="spinner"></span>';

    try {
        // Buscar organizacion por codigo de invitacion
        const orgsRef = window.firestore.collection(window.db, 'organizations');
        const orgsQuery = window.firestore.query(orgsRef, window.firestore.where('inviteCode', '==', inviteCode));
        const orgsSnapshot = await window.firestore.getDocs(orgsQuery);

        if (orgsSnapshot.empty) {
            showNotification('Codigo no encontrado', 'El codigo de invitacion ingresado no corresponde a ninguna organizacion. Verifica el codigo con tu gerente.', 'error');
            btnText.textContent = 'Unirse a la Organizacion';
            return;
        }

        const orgDoc = orgsSnapshot.docs[0];
        const orgData = orgDoc.data();
        const orgId = orgDoc.id;

        // Verificar si el usuario ya es miembro
        if (orgData.members && orgData.members.includes(currentUser.uid)) {
            showNotification('Ya eres miembro', 'Ya perteneces a esta organizacion.', 'info');
            await window.firestore.updateDoc(
                window.firestore.doc(window.db, 'users', currentUser.uid),
                { organizationId: orgId, role: 'agente', onboarded: true }
            );
            await loadApp(currentUser.uid);
            return;
        }

        // Agregar usuario a la organizacion
        const updatedMembers = orgData.members ? [...orgData.members, currentUser.uid] : [currentUser.uid];
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', orgId),
            { members: updatedMembers }
        );

        // Actualizar documento del usuario
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'users', currentUser.uid),
            { organizationId: orgId, role: 'agente', onboarded: true }
        );

        showNotification('Te uniste exitosamente', `Ahora eres parte de "${orgData.name}". Bienvenido al equipo!`, 'success');
        await loadApp(currentUser.uid);
    } catch (error) {
        console.error('Error al unirse:', error);
        showNotification('Error', 'No se pudo unir a la organizacion. Intenta de nuevo.\n\nDetalle: ' + error.message, 'error');
        btnText.textContent = 'Unirse a la Organizacion';
    }
});

// ========== FUNCIONES DE LA APP ==========

async function handleUserLogin(user) {
    currentUser = user;
    try {
        const userDoc = await window.firestore.getDoc(window.firestore.doc(window.db, 'users', user.uid));
        if (!userDoc.exists()) {
            // Crear documento de usuario si no existe (por si viene de OAuth)
            await window.firestore.setDoc(
                window.firestore.doc(window.db, 'users', user.uid),
                {
                    name: user.displayName || user.email.split('@')[0],
                    email: user.email,
                    createdAt: window.firestore.serverTimestamp(),
                    onboarded: false
                }
            );
            showOnboardingPage();
            return;
        }
        const userData = userDoc.data();
        currentUserData = userData;
        if (!userData.onboarded) {
            showOnboardingPage();
        } else {
            await loadApp(user.uid);
        }
    } catch (error) {
        console.error('Error al cargar datos del usuario:', error);
        showNotification('Error', 'No se pudieron cargar los datos del usuario.', 'error');
    }
}

function showAuthPage() {
    document.getElementById('authPage').style.display = 'flex';
    document.getElementById('onboardingPage').classList.add('hidden');
    document.getElementById('appLayout').classList.remove('active');
    // Reset forms
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginBtnText').textContent = 'Iniciar Sesion';
    document.getElementById('loginBtn').disabled = false;
}

function showOnboardingPage() {
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('onboardingPage').classList.remove('hidden');
    document.getElementById('appLayout').classList.remove('active');
    // Reset onboarding state
    goBackToStep1();
}

function getRoleDisplayName(role) {
    switch (role) {
        case 'admin': return 'Administrador';
        case 'gerente': return 'Gerente';
        case 'agente': return 'Agente';
        default: return role || 'Sin rol';
    }
}

async function loadApp(userId) {
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('onboardingPage').classList.add('hidden');

    try {
        const userDoc = await window.firestore.getDoc(window.firestore.doc(window.db, 'users', userId));
        const userData = userDoc.data();
        currentUserData = userData;

        const orgDoc = await window.firestore.getDoc(window.firestore.doc(window.db, 'organizations', userData.organizationId));
        if (!orgDoc.exists()) {
            showNotification('Error', 'No se encontro la organizacion. Contacta al administrador.', 'error');
            return;
        }
        currentOrganization = { id: orgDoc.id, ...orgDoc.data() };

        // Actualizar UI del sidebar
        const userName = userData.name || currentUser.email.split('@')[0];
        const userInitial = userName.charAt(0).toUpperCase();
        const roleDisplay = getRoleDisplayName(userData.role);

        document.getElementById('userName').textContent = userName;
        document.getElementById('userRole').textContent = roleDisplay;
        document.getElementById('userAvatar').textContent = userInitial;
        document.getElementById('orgNameDisplay').textContent = currentOrganization.name;

        // Cargar miembros del equipo
        await loadTeamMembers();

        // Actualizar pagina de configuracion
        updateSettingsPage(userData);

        // Agregar notificacion de bienvenida
        addAppNotification('Bienvenido', `Hola ${userName}, bienvenido a MessageHub.`, 'info');

        // Mostrar app
        document.getElementById('appLayout').classList.add('active');

        // Mostrar dashboard por defecto
        showPageDirect('dashboard');
    } catch (error) {
        console.error('Error al cargar la app:', error);
        showNotification('Error', 'No se pudo cargar la aplicacion. Intenta recargar la pagina.', 'error');
    }
}

async function loadTeamMembers() {
    if (!currentOrganization || !currentOrganization.members) return;

    const teamGrid = document.getElementById('teamGrid');
    const allTeamGrid = document.getElementById('allTeamGrid');
    teamMembers = [];

    for (const memberId of currentOrganization.members) {
        try {
            const memberDoc = await window.firestore.getDoc(window.firestore.doc(window.db, 'users', memberId));
            if (memberDoc.exists()) {
                teamMembers.push({ id: memberId, ...memberDoc.data() });
            }
        } catch (err) {
            console.error('Error cargando miembro:', err);
        }
    }

    const memberHTML = teamMembers.map(member => {
        const initial = (member.name || '?').charAt(0).toUpperCase();
        const role = getRoleDisplayName(member.role);
        const isCurrentUser = member.id === currentUser.uid;
        return `
            <div class="team-member${isCurrentUser ? ' current-user' : ''}">
                <div class="team-avatar">${initial}</div>
                <div class="team-info">
                    <div class="team-name">${member.name || 'Sin nombre'}${isCurrentUser ? ' (Tu)' : ''}</div>
                    <div class="team-role">${role}</div>
                </div>
                <div class="team-status" title="En linea"></div>
            </div>
        `;
    }).join('');

    if (teamGrid) teamGrid.innerHTML = memberHTML;
    if (allTeamGrid) allTeamGrid.innerHTML = memberHTML;
    document.getElementById('teamCount').textContent = teamMembers.length;
}

// ========== NAVEGACION DE PAGINAS ==========

function showPage(page) {
    const pages = ['dashboard', 'conversations', 'contacts', 'team', 'integrations', 'settings'];
    pages.forEach(p => {
        const el = document.getElementById(p + 'Page');
        if (el) el.classList.add('hidden');
    });

    const target = document.getElementById(page + 'Page');
    if (target) target.classList.remove('hidden');

    // Actualizar navegacion
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === page) item.classList.add('active');
    });

    // Actualizar titulo de pagina
    const titles = {
        dashboard: { title: 'Panel Principal', subtitle: 'Resumen de tu actividad de mensajeria' },
        conversations: { title: 'Conversaciones', subtitle: 'Gestiona todas tus conversaciones' },
        contacts: { title: 'Contactos', subtitle: 'Tu directorio de contactos' },
        team: { title: 'Equipo', subtitle: 'Gestiona los miembros de tu equipo' },
        integrations: { title: 'Integraciones', subtitle: 'Conecta tus plataformas de mensajeria' },
        settings: { title: 'Configuracion', subtitle: 'Preferencias de la organizacion' }
    };

    if (titles[page]) {
        document.getElementById('pageTitle').textContent = titles[page].title;
        document.getElementById('pageSubtitle').textContent = titles[page].subtitle;
    }

    // Cerrar sidebar en mobile
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('mobile-open');
}

// Version directa sin depender del event
function showPageDirect(page) {
    showPage(page);
}

function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('mobile-open');
}

// ========== MODALES ==========

// Invitar Miembro
function openInviteModal() {
    if (currentOrganization && currentOrganization.inviteCode) {
        document.getElementById('inviteCodeText').textContent = currentOrganization.inviteCode;
    }
    document.getElementById('inviteModal').classList.remove('hidden');
}

function closeInviteModal() {
    document.getElementById('inviteModal').classList.add('hidden');
}

function copyInviteCode() {
    if (!currentOrganization || !currentOrganization.inviteCode) return;
    const code = currentOrganization.inviteCode;
    navigator.clipboard.writeText(code).then(() => {
        document.getElementById('copyIcon').textContent = '✅';
        setTimeout(() => { document.getElementById('copyIcon').textContent = '📋'; }, 2000);
        addAppNotification('Codigo copiado', 'El codigo de invitacion fue copiado al portapapeles.', 'success');
    }).catch(() => {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = code;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        document.getElementById('copyIcon').textContent = '✅';
        setTimeout(() => { document.getElementById('copyIcon').textContent = '📋'; }, 2000);
    });
}

// Ayuda
function openHelpModal() {
    document.getElementById('helpModal').classList.remove('hidden');
}

function closeHelpModal() {
    document.getElementById('helpModal').classList.add('hidden');
}

function toggleHelpItem(el) {
    const answer = el.querySelector('.help-answer');
    const arrow = el.querySelector('.help-arrow');
    if (answer) {
        answer.classList.toggle('hidden');
        if (arrow) arrow.style.transform = answer.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
    }
}

// Perfil
function openProfileModal() {
    if (currentUserData) {
        const name = currentUserData.name || currentUser.email.split('@')[0];
        document.getElementById('profileAvatarLarge').textContent = name.charAt(0).toUpperCase();
        document.getElementById('profileName').textContent = name;
        document.getElementById('profileEmail').textContent = currentUser.email || '--';
        document.getElementById('profileRole').textContent = getRoleDisplayName(currentUserData.role);
        document.getElementById('profileOrg').textContent = currentOrganization ? currentOrganization.name : '--';
    }
    document.getElementById('profileModal').classList.remove('hidden');
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.add('hidden');
}

// Cerrar modales al hacer clic fuera
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.add('hidden');
    }
});

// ========== PANEL DE NOTIFICACIONES ==========

function addAppNotification(title, message, type = 'info') {
    const notif = {
        id: Date.now(),
        title: title,
        message: message,
        type: type,
        time: new Date(),
        read: false
    };
    appNotifications.unshift(notif);
    if (appNotifications.length > 20) appNotifications.pop();
    updateNotificationsPanel();
}

function toggleNotificationsPanel() {
    const panel = document.getElementById('notificationsPanel');
    panel.classList.toggle('hidden');
    // Cerrar al hacer clic fuera
    if (!panel.classList.contains('hidden')) {
        setTimeout(() => {
            document.addEventListener('click', closeNotifPanelOnClickOutside);
        }, 100);
    }
}

function closeNotifPanelOnClickOutside(e) {
    const panel = document.getElementById('notificationsPanel');
    const wrapper = document.querySelector('.notification-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        panel.classList.add('hidden');
        document.removeEventListener('click', closeNotifPanelOnClickOutside);
    }
}

function updateNotificationsPanel() {
    const body = document.getElementById('notifPanelBody');
    const dot = document.getElementById('notifDot');
    const unread = appNotifications.filter(n => !n.read).length;

    if (unread > 0) {
        dot.classList.remove('hidden');
    } else {
        dot.classList.add('hidden');
    }

    if (appNotifications.length === 0) {
        body.innerHTML = '<div class="notif-empty">No hay notificaciones</div>';
        return;
    }

    body.innerHTML = appNotifications.map(n => {
        const icon = n.type === 'success' ? '✅' : n.type === 'error' ? '⚠️' : n.type === 'warning' ? '⚠️' : 'ℹ️';
        const timeStr = formatTimeAgo(n.time);
        return `
            <div class="notif-item${n.read ? '' : ' unread'}" onclick="markNotifRead(${n.id})">
                <span class="notif-item-icon">${icon}</span>
                <div class="notif-item-content">
                    <div class="notif-item-title">${n.title}</div>
                    <div class="notif-item-msg">${n.message}</div>
                    <div class="notif-item-time">${timeStr}</div>
                </div>
            </div>
        `;
    }).join('');
}

function markNotifRead(id) {
    const notif = appNotifications.find(n => n.id === id);
    if (notif) notif.read = true;
    updateNotificationsPanel();
}

function clearAllNotifications() {
    appNotifications = [];
    updateNotificationsPanel();
}

function formatTimeAgo(date) {
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'Justo ahora';
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
    return `Hace ${Math.floor(diff / 86400)} d`;
}

// ========== BUSQUEDA ==========

function handleSearch(query) {
    const resultsEl = document.getElementById('searchResults');
    if (!query || query.trim().length < 2) {
        resultsEl.classList.add('hidden');
        return;
    }

    const q = query.toLowerCase().trim();
    const results = [];

    // Buscar en paginas
    const pages = [
        { name: 'Panel Principal', page: 'dashboard', icon: '📊' },
        { name: 'Conversaciones', page: 'conversations', icon: '💬' },
        { name: 'Contactos', page: 'contacts', icon: '👥' },
        { name: 'Equipo', page: 'team', icon: '👨‍💼' },
        { name: 'Integraciones', page: 'integrations', icon: '🔌' },
        { name: 'Configuracion', page: 'settings', icon: '⚙️' },
    ];

    pages.forEach(p => {
        if (p.name.toLowerCase().includes(q)) {
            results.push({ type: 'page', ...p });
        }
    });

    // Buscar en miembros del equipo
    teamMembers.forEach(member => {
        if ((member.name && member.name.toLowerCase().includes(q)) ||
            (member.email && member.email.toLowerCase().includes(q))) {
            results.push({ type: 'member', name: member.name, icon: '👤', role: getRoleDisplayName(member.role) });
        }
    });

    // Buscar acciones
    const actions = [
        { name: 'Invitar Miembro', action: 'openInviteModal()', icon: '➕' },
        { name: 'Cerrar Sesion', action: 'handleLogout()', icon: '🚪' },
        { name: 'Ayuda', action: 'openHelpModal()', icon: '❓' },
        { name: 'Mi Perfil', action: 'openProfileModal()', icon: '👤' },
        { name: 'WhatsApp', action: "connectIntegration('whatsapp')", icon: '📱' },
        { name: 'Instagram', action: "connectIntegration('instagram')", icon: '📷' },
        { name: 'Messenger', action: "connectIntegration('messenger')", icon: '💬' },
    ];

    actions.forEach(a => {
        if (a.name.toLowerCase().includes(q)) {
            results.push({ type: 'action', ...a });
        }
    });

    if (results.length === 0) {
        resultsEl.innerHTML = '<div class="search-result-empty">Sin resultados para "' + query + '"</div>';
    } else {
        resultsEl.innerHTML = results.slice(0, 8).map(r => {
            if (r.type === 'page') {
                return `<div class="search-result-item" onmousedown="showPage('${r.page}'); closeSearchResults();">
                    <span>${r.icon}</span><span>${r.name}</span><span class="search-result-type">Pagina</span>
                </div>`;
            } else if (r.type === 'member') {
                return `<div class="search-result-item" onmousedown="showPage('team'); closeSearchResults();">
                    <span>${r.icon}</span><span>${r.name}</span><span class="search-result-type">${r.role}</span>
                </div>`;
            } else {
                return `<div class="search-result-item" onmousedown="${r.action}; closeSearchResults();">
                    <span>${r.icon}</span><span>${r.name}</span><span class="search-result-type">Accion</span>
                </div>`;
            }
        }).join('');
    }

    resultsEl.classList.remove('hidden');
}

function closeSearchResults() {
    document.getElementById('searchResults').classList.add('hidden');
    document.getElementById('searchInput').value = '';
}

// ========== CONFIGURACION ==========

function updateSettingsPage(userData) {
    const name = userData.name || currentUser.email.split('@')[0];
    document.getElementById('settingsName').textContent = name;
    document.getElementById('settingsEmail').textContent = currentUser.email || '--';
    document.getElementById('settingsRole').textContent = getRoleDisplayName(userData.role);
    if (currentOrganization) {
        document.getElementById('settingsOrgName').textContent = currentOrganization.name;
        document.getElementById('settingsInviteCode').textContent = currentOrganization.inviteCode || '--';
    }
}

function copySettingsInviteCode() {
    if (!currentOrganization || !currentOrganization.inviteCode) return;
    navigator.clipboard.writeText(currentOrganization.inviteCode).then(() => {
        addAppNotification('Codigo copiado', 'Codigo de invitacion copiado al portapapeles.', 'success');
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = currentOrganization.inviteCode;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        addAppNotification('Codigo copiado', 'Codigo de invitacion copiado al portapapeles.', 'success');
    });
}

// ========== INTEGRACIONES ==========

function connectIntegration(platform) {
    const names = { whatsapp: 'WhatsApp Business', instagram: 'Instagram Direct', messenger: 'Messenger' };
    const name = names[platform] || platform;
    showNotification(
        'Conectar ' + name,
        `Para conectar ${name} necesitas:\n\n1. Una cuenta de Meta Business Suite\n2. Configurar la API de ${name}\n3. Obtener el token de acceso\n4. Configurar el webhook\n\nContacta al administrador del sistema para completar la configuracion.`,
        'info'
    );
}

// ========== CONVERSACIONES ==========

let currentConvFilter = 'all';

function filterConversations(query) {
    // Se implementara cuando haya conversaciones reales
    console.log('Filtrar conversaciones:', query);
}

function setConvFilter(filter, btn) {
    currentConvFilter = filter;
    document.querySelectorAll('.conv-filter').forEach(f => f.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

// ========== UTILIDADES ==========

function generateOrgId() {
    return 'org_' + Math.random().toString(36).substr(2, 9);
}

function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 10; i++) {
        if (i === 5) code += '-';
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Cerrar paneles al presionar Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeNotification();
        closeInviteModal();
        closeHelpModal();
        closeProfileModal();
        closeLogoutModal();
        closeSearchResults();
        document.getElementById('notificationsPanel')?.classList.add('hidden');
    }
});

// Inicializacion
console.log('MessageHub SaaS inicializado');
