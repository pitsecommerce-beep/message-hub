// MessageHub SaaS - Logica de Aplicacion

// ========== ESTADO GLOBAL ==========
let currentUser = null;
let currentUserData = null;
let currentOrganization = null;
let selectedRole = null;
let appNotifications = [];
let teamMembers = [];
let contacts = [];
let pendingRegistration = null; // Para registro diferido
window.suppressAuthRedirect = false;

// Etapas del funnel de ventas
const FUNNEL_STAGES = [
    { id: 'curioso', name: 'Curioso', color: '#3B82F6' },
    { id: 'cotizando', name: 'Cotizando', color: '#F59E0B' },
    { id: 'pago_pendiente', name: 'Pago Pendiente', color: '#EF4444' },
    { id: 'orden_pendiente', name: 'Orden Pendiente', color: '#8B5CF6' },
    { id: 'entregado', name: 'Entregado', color: '#10B981' },
    { id: 'atencion_inmediata', name: 'Atencion Inmediata', color: '#EC4899' }
];

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
            return { title: 'Correo ya registrado', message: 'Este correo electronico ya esta registrado. Cambia a "Iniciar Sesion" para acceder a tu cuenta existente.' };
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

// Registro - DIFERIDO: no crea usuario hasta completar onboarding
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const btnText = document.getElementById('registerBtnText');
    const btn = document.getElementById('registerBtn');

    if (!name) {
        showNotification('Campo requerido', 'Ingresa tu nombre completo.', 'warning');
        return;
    }
    if (password.length < 6) {
        showNotification('Contrasena muy corta', 'La contrasena debe tener al menos 6 caracteres.', 'warning');
        return;
    }

    btnText.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;

    // Guardar datos para crear usuario despues del onboarding
    pendingRegistration = { name, email, password };

    // Mostrar onboarding sin crear usuario aun
    showOnboardingPage();
    btnText.textContent = 'Crear Cuenta';
    btn.disabled = false;
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
        contacts = [];
        pendingRegistration = null;
        window.suppressAuthRedirect = false;
    } catch (error) {
        console.error('Error al cerrar sesion:', error);
        showNotification('Error', 'No se pudo cerrar sesion. Intenta de nuevo.', 'error');
    }
}

// Cancelar onboarding (volver a auth)
function cancelOnboarding() {
    if (pendingRegistration) {
        // No hay usuario creado, solo limpiar y volver
        pendingRegistration = null;
        window.suppressAuthRedirect = false;
        showAuthPage();
    } else if (currentUser) {
        // Usuario ya existe, cerrar sesion
        handleLogout();
    } else {
        showAuthPage();
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

// Funcion auxiliar: crear usuario Firebase desde pendingRegistration
async function createPendingUser() {
    if (!pendingRegistration) return null;
    window.suppressAuthRedirect = true;
    try {
        const cred = await window.firebaseAuth.createUserWithEmailAndPassword(
            window.auth, pendingRegistration.email, pendingRegistration.password
        );
        await window.firebaseAuth.updateProfile(cred.user, { displayName: pendingRegistration.name });
        currentUser = cred.user;
        return cred.user;
    } catch (error) {
        window.suppressAuthRedirect = false;
        throw error;
    }
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
        // Si hay registro pendiente, crear usuario primero
        if (pendingRegistration) {
            await createPendingUser();
        }

        const orgId = generateOrgId();
        const inviteCode = generateInviteCode();
        const userName = pendingRegistration ? pendingRegistration.name : (currentUserData?.name || currentUser.displayName || currentUser.email.split('@')[0]);
        const userEmail = pendingRegistration ? pendingRegistration.email : currentUser.email;

        await window.firestore.setDoc(
            window.firestore.doc(window.db, 'organizations', orgId),
            {
                name: orgName,
                industry: orgIndustry,
                ownerId: currentUser.uid,
                inviteCode: inviteCode,
                createdAt: window.firestore.serverTimestamp(),
                members: [currentUser.uid],
                integrations: { whatsapp: false, instagram: false, messenger: false, stripe: false, mercadopago: false }
            }
        );

        // Crear o actualizar documento del usuario
        await window.firestore.setDoc(
            window.firestore.doc(window.db, 'users', currentUser.uid),
            {
                name: userName,
                email: userEmail,
                organizationId: orgId,
                role: 'gerente',
                onboarded: true,
                createdAt: window.firestore.serverTimestamp()
            }
        );

        pendingRegistration = null;
        window.suppressAuthRedirect = false;

        showNotification(
            'Organizacion creada',
            `Tu organizacion "${orgName}" fue creada exitosamente.\n\nCodigo de invitacion: ${inviteCode}\n\nComparte este codigo con tu equipo para que se unan.`,
            'success'
        );
        await loadApp(currentUser.uid);
    } catch (error) {
        console.error('Error al crear organizacion:', error);
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) {
            showNotification(errorInfo.title, errorInfo.message, 'error');
        } else {
            showNotification('Error', 'No se pudo crear la organizacion: ' + error.message, 'error');
        }
        btnText.textContent = 'Crear Organizacion';
        pendingRegistration = null;
        window.suppressAuthRedirect = false;
    }
});

// Unirse a organizacion (Agente) - Valida codigo ANTES de crear usuario
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
        // PRIMERO: validar codigo de invitacion
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

        // SEGUNDO: crear usuario si hay registro pendiente
        if (pendingRegistration) {
            await createPendingUser();
        }

        // Verificar si el usuario ya es miembro
        if (orgData.members && orgData.members.includes(currentUser.uid)) {
            showNotification('Ya eres miembro', 'Ya perteneces a esta organizacion.', 'info');
            await window.firestore.setDoc(
                window.firestore.doc(window.db, 'users', currentUser.uid),
                {
                    name: currentUser.displayName || currentUser.email.split('@')[0],
                    email: currentUser.email,
                    organizationId: orgId,
                    role: 'agente',
                    onboarded: true,
                    createdAt: window.firestore.serverTimestamp()
                }
            );
            pendingRegistration = null;
            window.suppressAuthRedirect = false;
            await loadApp(currentUser.uid);
            return;
        }

        // Agregar usuario a la organizacion
        const updatedMembers = orgData.members ? [...orgData.members, currentUser.uid] : [currentUser.uid];
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', orgId),
            { members: updatedMembers }
        );

        // Crear documento del usuario
        const userName = pendingRegistration ? pendingRegistration.name : (currentUser.displayName || currentUser.email.split('@')[0]);
        await window.firestore.setDoc(
            window.firestore.doc(window.db, 'users', currentUser.uid),
            {
                name: userName,
                email: currentUser.email,
                organizationId: orgId,
                role: 'agente',
                onboarded: true,
                createdAt: window.firestore.serverTimestamp()
            }
        );

        pendingRegistration = null;
        window.suppressAuthRedirect = false;

        showNotification('Te uniste exitosamente', `Ahora eres parte de "${orgData.name}". Bienvenido al equipo!`, 'success');
        await loadApp(currentUser.uid);
    } catch (error) {
        console.error('Error al unirse:', error);
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) {
            showNotification(errorInfo.title, errorInfo.message, 'error');
        } else {
            showNotification('Error', 'No se pudo unir a la organizacion. Intenta de nuevo.\n\nDetalle: ' + error.message, 'error');
        }
        btnText.textContent = 'Unirse a la Organizacion';
        pendingRegistration = null;
        window.suppressAuthRedirect = false;
    }
});

// ========== FUNCIONES DE LA APP ==========

async function handleUserLogin(user) {
    currentUser = user;
    try {
        const userDoc = await window.firestore.getDoc(window.firestore.doc(window.db, 'users', user.uid));
        if (!userDoc.exists()) {
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
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginBtnText').textContent = 'Iniciar Sesion';
    document.getElementById('loginBtn').disabled = false;
}

function showOnboardingPage() {
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('onboardingPage').classList.remove('hidden');
    document.getElementById('appLayout').classList.remove('active');
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

        const userName = userData.name || currentUser.email.split('@')[0];
        const userInitial = userName.charAt(0).toUpperCase();
        const roleDisplay = getRoleDisplayName(userData.role);

        document.getElementById('userName').textContent = userName;
        document.getElementById('userRole').textContent = roleDisplay;
        document.getElementById('userAvatar').textContent = userInitial;
        document.getElementById('orgNameDisplay').textContent = currentOrganization.name;

        await loadTeamMembers();
        await loadContacts();
        updateSettingsPage(userData);

        addAppNotification('Bienvenido', `Hola ${userName}, bienvenido a MessageHub.`, 'info');

        document.getElementById('appLayout').classList.add('active');
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

    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === page) item.classList.add('active');
    });

    const titles = {
        dashboard: { title: 'Panel Principal', subtitle: 'Resumen de tu actividad de mensajeria' },
        conversations: { title: 'Conversaciones', subtitle: 'Gestiona todas tus conversaciones y funnel de ventas' },
        contacts: { title: 'Contactos', subtitle: 'Directorio de contactos enriquecido' },
        team: { title: 'Equipo', subtitle: 'Gestiona los miembros de tu equipo' },
        integrations: { title: 'Integraciones', subtitle: 'Conecta plataformas de mensajeria y pasarelas de pago' },
        settings: { title: 'Configuracion', subtitle: 'Preferencias de la organizacion' }
    };

    if (titles[page]) {
        document.getElementById('pageTitle').textContent = titles[page].title;
        document.getElementById('pageSubtitle').textContent = titles[page].subtitle;
    }

    // Refrescar funnel si se va a conversaciones
    if (page === 'conversations') {
        renderFunnel();
    }

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('mobile-open');
}

function showPageDirect(page) {
    showPage(page);
}

function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('mobile-open');
}

// ========== VISTA DE CONVERSACIONES / FUNNEL ==========

function setConvView(view) {
    const chatView = document.getElementById('chatView');
    const funnelView = document.getElementById('funnelView');
    const btns = document.querySelectorAll('.conv-view-btn');

    btns.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.view === view) btn.classList.add('active');
    });

    if (view === 'chat') {
        chatView.classList.remove('hidden');
        funnelView.classList.add('hidden');
    } else {
        chatView.classList.add('hidden');
        funnelView.classList.remove('hidden');
        renderFunnel();
    }
}

// ========== FUNNEL DE VENTAS (KANBAN) ==========

let draggedContactId = null;

function renderFunnel() {
    FUNNEL_STAGES.forEach(stage => {
        const body = document.getElementById('funnel' + capitalize(stage.id));
        const countEl = document.getElementById('count' + capitalize(stage.id));
        if (!body) return;

        const stageContacts = contacts.filter(c => c.funnelStage === stage.id);
        countEl.textContent = stageContacts.length;

        if (stageContacts.length === 0) {
            body.innerHTML = '<div class="funnel-empty">Arrastra contactos aqui</div>';
            return;
        }

        body.innerHTML = stageContacts.map(contact => {
            const timeInStage = contact.stageChangedAt ? getTimeInStage(contact.stageChangedAt) : '--';
            return `
                <div class="funnel-card" draggable="true"
                     ondragstart="handleDragStart(event, '${contact.id}')"
                     data-contact-id="${contact.id}">
                    <div class="funnel-card-name">${escapeHtml(contact.name)}</div>
                    ${contact.company ? `<div class="funnel-card-company">${escapeHtml(contact.company)}</div>` : ''}
                    ${contact.phone ? `<div class="funnel-card-phone">${escapeHtml(contact.phone)}</div>` : ''}
                    <div class="funnel-card-time">${timeInStage}</div>
                    <div class="funnel-card-actions">
                        <button class="funnel-card-btn" onclick="editContactFromFunnel('${contact.id}')" title="Editar">✏️</button>
                    </div>
                </div>
            `;
        }).join('');
    });
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function getTimeInStage(timestamp) {
    if (!timestamp) return '--';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'Hace unos segundos';
    if (diff < 3600) return `${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
    const days = Math.floor(diff / 86400);
    if (days === 1) return '1 dia';
    return `${days} dias`;
}

function handleDragStart(event, contactId) {
    draggedContactId = contactId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', contactId);
    event.target.classList.add('dragging');
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-over');
}

function handleDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
}

async function handleDrop(event, newStage) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    const contactId = event.dataTransfer.getData('text/plain') || draggedContactId;
    if (!contactId) return;

    const contact = contacts.find(c => c.id === contactId);
    if (!contact || contact.funnelStage === newStage) {
        draggedContactId = null;
        return;
    }

    try {
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'contacts', contactId),
            { funnelStage: newStage, stageChangedAt: window.firestore.serverTimestamp() }
        );
        contact.funnelStage = newStage;
        contact.stageChangedAt = new Date();
        renderFunnel();
        renderContactsTable();
        addAppNotification('Contacto movido', `${contact.name} movido a "${getStageName(newStage)}"`, 'success');
    } catch (error) {
        console.error('Error al mover contacto:', error);
        showNotification('Error', 'No se pudo mover el contacto. Intenta de nuevo.', 'error');
    }
    draggedContactId = null;
}

function getStageName(stageId) {
    const stage = FUNNEL_STAGES.find(s => s.id === stageId);
    return stage ? stage.name : stageId;
}

function editContactFromFunnel(contactId) {
    const contact = contacts.find(c => c.id === contactId);
    if (contact) openContactModal(contact);
}

// ========== CONTACTOS CRUD ==========

async function loadContacts() {
    if (!currentOrganization) return;

    try {
        const contactsRef = window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'contacts');
        const snapshot = await window.firestore.getDocs(contactsRef);
        contacts = [];
        snapshot.forEach(doc => {
            contacts.push({ id: doc.id, ...doc.data() });
        });

        document.getElementById('statContacts').textContent = contacts.length;
        renderContactsTable();
        renderFunnel();
    } catch (error) {
        console.error('Error cargando contactos:', error);
    }
}

function renderContactsTable() {
    const tbody = document.getElementById('contactsTableBody');
    if (!tbody) return;

    if (contacts.length === 0) {
        tbody.innerHTML = `
            <tr class="contacts-empty-row">
                <td colspan="7">
                    <div class="contacts-empty-state">
                        <span>📇</span>
                        <p>No hay contactos aun. Agrega tu primer contacto.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = contacts.map(contact => {
        const stageName = getStageName(contact.funnelStage || 'curioso');
        const stageClass = 'stage-badge stage-' + (contact.funnelStage || 'curioso');
        return `
            <tr>
                <td><strong>${escapeHtml(contact.name)}</strong></td>
                <td>${escapeHtml(contact.company || '--')}</td>
                <td>${escapeHtml(contact.phone || '--')}</td>
                <td>${escapeHtml(contact.email || '--')}</td>
                <td>${escapeHtml(contact.rfc || '--')}</td>
                <td><span class="${stageClass}">${stageName}</span></td>
                <td class="contacts-actions">
                    <button class="btn-table-action" onclick="openContactModal(contacts.find(c=>c.id==='${contact.id}'))" title="Editar">✏️</button>
                    <button class="btn-table-action btn-table-delete" onclick="deleteContact('${contact.id}')" title="Eliminar">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterContacts(query) {
    const tbody = document.getElementById('contactsTableBody');
    if (!query || !query.trim()) {
        renderContactsTable();
        return;
    }
    const q = query.toLowerCase().trim();
    const filtered = contacts.filter(c =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.company && c.company.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.rfc && c.rfc.toLowerCase().includes(q))
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-tertiary)">Sin resultados para "${escapeHtml(query)}"</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(contact => {
        const stageName = getStageName(contact.funnelStage || 'curioso');
        const stageClass = 'stage-badge stage-' + (contact.funnelStage || 'curioso');
        return `
            <tr>
                <td><strong>${escapeHtml(contact.name)}</strong></td>
                <td>${escapeHtml(contact.company || '--')}</td>
                <td>${escapeHtml(contact.phone || '--')}</td>
                <td>${escapeHtml(contact.email || '--')}</td>
                <td>${escapeHtml(contact.rfc || '--')}</td>
                <td><span class="${stageClass}">${stageName}</span></td>
                <td class="contacts-actions">
                    <button class="btn-table-action" onclick="openContactModal(contacts.find(c=>c.id==='${contact.id}'))" title="Editar">✏️</button>
                    <button class="btn-table-action btn-table-delete" onclick="deleteContact('${contact.id}')" title="Eliminar">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

function openContactModal(contact = null) {
    const modal = document.getElementById('contactModal');
    const title = document.getElementById('contactModalTitle');

    if (contact) {
        title.textContent = 'Editar Contacto';
        document.getElementById('contactEditId').value = contact.id;
        document.getElementById('contactName').value = contact.name || '';
        document.getElementById('contactCompany').value = contact.company || '';
        document.getElementById('contactPhone').value = contact.phone || '';
        document.getElementById('contactEmailField').value = contact.email || '';
        document.getElementById('contactRFC').value = contact.rfc || '';
        document.getElementById('contactAddress').value = contact.address || '';
        document.getElementById('contactStage').value = contact.funnelStage || 'curioso';
        document.getElementById('contactNotes').value = contact.notes || '';
    } else {
        title.textContent = 'Agregar Contacto';
        document.getElementById('contactEditId').value = '';
        document.getElementById('contactForm').reset();
        document.getElementById('contactStage').value = 'curioso';
    }

    modal.classList.remove('hidden');
}

function closeContactModal() {
    document.getElementById('contactModal').classList.add('hidden');
}

async function saveContact() {
    const name = document.getElementById('contactName').value.trim();
    if (!name) {
        showNotification('Campo requerido', 'El nombre del contacto es obligatorio.', 'warning');
        return;
    }

    const contactData = {
        name: name,
        company: document.getElementById('contactCompany').value.trim(),
        phone: document.getElementById('contactPhone').value.trim(),
        email: document.getElementById('contactEmailField').value.trim(),
        rfc: document.getElementById('contactRFC').value.trim().toUpperCase(),
        address: document.getElementById('contactAddress').value.trim(),
        funnelStage: document.getElementById('contactStage').value,
        notes: document.getElementById('contactNotes').value.trim(),
        updatedAt: window.firestore.serverTimestamp()
    };

    const editId = document.getElementById('contactEditId').value;

    try {
        if (editId) {
            await window.firestore.updateDoc(
                window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'contacts', editId),
                contactData
            );
            const idx = contacts.findIndex(c => c.id === editId);
            if (idx !== -1) {
                contacts[idx] = { ...contacts[idx], ...contactData, updatedAt: new Date() };
            }
            showNotification('Contacto actualizado', `${name} fue actualizado correctamente.`, 'success');
        } else {
            contactData.createdAt = window.firestore.serverTimestamp();
            contactData.stageChangedAt = window.firestore.serverTimestamp();
            contactData.createdBy = currentUser.uid;
            const docRef = await window.firestore.addDoc(
                window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'contacts'),
                contactData
            );
            contacts.push({ id: docRef.id, ...contactData, stageChangedAt: new Date(), createdAt: new Date() });
            showNotification('Contacto agregado', `${name} fue agregado al directorio.`, 'success');
        }

        document.getElementById('statContacts').textContent = contacts.length;
        renderContactsTable();
        renderFunnel();
        closeContactModal();
    } catch (error) {
        console.error('Error al guardar contacto:', error);
        showNotification('Error', 'No se pudo guardar el contacto: ' + error.message, 'error');
    }
}

async function deleteContact(contactId) {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    if (!confirm(`Eliminar a "${contact.name}" del directorio?`)) return;

    try {
        await window.firestore.deleteDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'contacts', contactId)
        );
        contacts = contacts.filter(c => c.id !== contactId);
        document.getElementById('statContacts').textContent = contacts.length;
        renderContactsTable();
        renderFunnel();
        showNotification('Contacto eliminado', `${contact.name} fue eliminado del directorio.`, 'success');
    } catch (error) {
        console.error('Error al eliminar contacto:', error);
        showNotification('Error', 'No se pudo eliminar el contacto.', 'error');
    }
}

// ========== MODALES ==========

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

    if (unread > 0) dot.classList.remove('hidden');
    else dot.classList.add('hidden');

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

    const pages = [
        { name: 'Panel Principal', page: 'dashboard', icon: '📊' },
        { name: 'Conversaciones', page: 'conversations', icon: '💬' },
        { name: 'Funnel de Ventas', page: 'conversations', icon: '📊' },
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

    teamMembers.forEach(member => {
        if ((member.name && member.name.toLowerCase().includes(q)) ||
            (member.email && member.email.toLowerCase().includes(q))) {
            results.push({ type: 'member', name: member.name, icon: '👤', role: getRoleDisplayName(member.role) });
        }
    });

    contacts.forEach(contact => {
        if ((contact.name && contact.name.toLowerCase().includes(q)) ||
            (contact.company && contact.company.toLowerCase().includes(q)) ||
            (contact.phone && contact.phone.includes(q))) {
            results.push({ type: 'contact', name: contact.name, icon: '📇', detail: contact.company || contact.phone || '' });
        }
    });

    const actions = [
        { name: 'Invitar Miembro', action: 'openInviteModal()', icon: '➕' },
        { name: 'Agregar Contacto', action: 'openContactModal()', icon: '📇' },
        { name: 'Cerrar Sesion', action: 'handleLogout()', icon: '🚪' },
        { name: 'Ayuda', action: 'openHelpModal()', icon: '❓' },
        { name: 'Mi Perfil', action: 'openProfileModal()', icon: '👤' },
        { name: 'WhatsApp', action: "connectIntegration('whatsapp')", icon: '📱' },
        { name: 'Instagram', action: "connectIntegration('instagram')", icon: '📷' },
        { name: 'Messenger', action: "connectIntegration('messenger')", icon: '💬' },
        { name: 'Stripe', action: "connectPayment('stripe')", icon: '💳' },
        { name: 'MercadoPago', action: "connectPayment('mercadopago')", icon: '🏦' },
    ];

    actions.forEach(a => {
        if (a.name.toLowerCase().includes(q)) {
            results.push({ type: 'action', ...a });
        }
    });

    if (results.length === 0) {
        resultsEl.innerHTML = '<div class="search-result-empty">Sin resultados para "' + escapeHtml(query) + '"</div>';
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
            } else if (r.type === 'contact') {
                return `<div class="search-result-item" onmousedown="showPage('contacts'); closeSearchResults();">
                    <span>${r.icon}</span><span>${r.name}</span><span class="search-result-type">${r.detail}</span>
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

// ========== INTEGRACIONES DE MENSAJERIA ==========

function connectIntegration(platform) {
    const names = { whatsapp: 'WhatsApp Business', instagram: 'Instagram Direct', messenger: 'Messenger' };
    const name = names[platform] || platform;
    showNotification(
        'Conectar ' + name,
        `Para conectar ${name} necesitas:\n\n1. Una cuenta de Meta Business Suite\n2. Configurar la API de ${name}\n3. Obtener el token de acceso\n4. Configurar el webhook en Firebase Cloud Functions\n\nConsulta la Guia de Integracion Meta incluida en el proyecto.`,
        'info'
    );
}

// ========== INTEGRACIONES DE PAGO ==========

function connectPayment(gateway) {
    const names = { stripe: 'Stripe', mercadopago: 'MercadoPago' };
    const name = names[gateway] || gateway;

    if (gateway === 'stripe') {
        showNotification(
            'Conectar Stripe',
            `Para conectar Stripe necesitas:\n\n1. Crear una cuenta en stripe.com\n2. Obtener tus API Keys (Publishable + Secret)\n3. Configurar las keys en Firebase Cloud Functions\n4. Crear un endpoint para generar Payment Links\n\nLa Secret Key se almacena solo en el backend (Cloud Functions), nunca en el frontend.\n\nUna vez conectado, podras generar ligas de pago desde cualquier conversacion.`,
            'info'
        );
    } else if (gateway === 'mercadopago') {
        showNotification(
            'Conectar MercadoPago',
            `Para conectar MercadoPago necesitas:\n\n1. Crear una cuenta en mercadopago.com.mx\n2. Crear una aplicacion en el panel de desarrolladores\n3. Obtener tu Access Token y Public Key\n4. Configurar las credenciales en Firebase Cloud Functions\n\nEl Access Token se almacena solo en el backend (Cloud Functions).\n\nUna vez conectado, podras generar ligas de pago con OXXO, transferencia y tarjeta.`,
            'info'
        );
    }
}

// ========== CONVERSACIONES ==========

let currentConvFilter = 'all';

function filterConversations(query) {
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

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Cerrar paneles al presionar Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeNotification();
        closeInviteModal();
        closeHelpModal();
        closeProfileModal();
        closeContactModal();
        closeLogoutModal();
        closeSearchResults();
        document.getElementById('notificationsPanel')?.classList.add('hidden');
    }
});

// Inicializacion
console.log('MessageHub SaaS inicializado');
