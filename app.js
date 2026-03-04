// MessageHub SaaS - Lógica de Aplicación

// ========== ESTADO GLOBAL ==========
let currentUser = null;
let currentUserData = null;
let currentOrganization = null;
let selectedRole = null;
let appNotifications = [];
let teamMembers = [];
let contacts = [];
let pendingRegistration = null; // Para registro diferido
let pendingConvToOpen = null;           // Conversation ID to auto-open after loadConversations()
let pendingOrderPaymentLinkData = null; // {total, description, orderId} to pre-fill payment modal after conv opens
let pendingPaymentOrderId = null;       // orderId to link to the next payment link created
window.suppressAuthRedirect = false;

// Etapas del funnel de ventas
const FUNNEL_STAGES = [
    { id: 'curioso', name: 'Curioso', color: '#3B82F6' },
    { id: 'cotizando', name: 'Cotizando', color: '#F59E0B' },
    { id: 'pago_pendiente', name: 'Pago Pendiente', color: '#EF4444' },
    { id: 'orden_pendiente', name: 'Orden Pendiente', color: '#8B5CF6' },
    { id: 'entregado', name: 'Entregado', color: '#10B981' },
    { id: 'atencion_inmediata', name: 'Atención Inmediata', color: '#EC4899' }
];

// ========== FUNCIONES DE NOTIFICACION (MODAL) ==========

function showNotification(title, message, type = 'error') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    // error persists until dismissed; others auto-dismiss
    const durations = { success: 4000, info: 4000, warning: 6000, error: 0 };
    const duration  = durations[type] ?? 4000;
    const icons     = { error: '⛔', success: '✅', warning: '⚠️', info: 'ℹ️' };
    const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.id = id;
    toast.innerHTML =
        `<span class="toast-icon">${icons[type] || 'ℹ️'}</span>` +
        `<div class="toast-content">` +
            `<div class="toast-title">${escapeHtml(title)}</div>` +
            (message ? `<div class="toast-msg">${escapeHtml(message)}</div>` : '') +
        `</div>` +
        `<button class="toast-close" onclick="dismissToast('${id}')">×</button>` +
        (duration > 0 ? `<div class="toast-progress" style="animation-duration:${duration}ms"></div>` : '');

    container.appendChild(toast);
    if (duration > 0) setTimeout(() => dismissToast(id), duration);
}

function dismissToast(id) {
    const toast = document.getElementById(id);
    if (!toast) return;
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

function closeNotification() {} // backwards compatibility

function getFirebaseAuthErrorMessage(error) {
    const currentDomain = window.location.hostname || window.location.href;
    switch (error.code) {
        case 'auth/unauthorized-domain':
            return {
                title: 'Dominio no autorizado',
                message: `El dominio actual (${currentDomain}) no está autorizado para inicio de sesión con OAuth.\n\nPara solucionarlo:\n1. Ve a Firebase Console\n2. Selecciona tu proyecto\n3. Ve a Authentication > Settings > Authorized domains\n4. Agrega: ${currentDomain}\n\nMientras tanto, usa email y contraseña.`
            };
        case 'auth/popup-blocked':
            return { title: 'Ventana bloqueada', message: 'El navegador bloqueó la ventana emergente. Permite ventanas emergentes para este sitio e intenta de nuevo.' };
        case 'auth/popup-closed-by-user':
            return { title: 'Inicio cancelado', message: 'Se cerró la ventana de inicio de sesión antes de completar el proceso.' };
        case 'auth/account-exists-with-different-credential':
            return { title: 'Cuenta existente', message: 'Ya existe una cuenta con este email usando otro método de inicio de sesión. Intenta con el método original.' };
        case 'auth/email-already-in-use':
            return { title: 'Correo ya registrado', message: 'Este correo electrónico ya está registrado. Cambia a "Iniciar Sesión" para acceder a tu cuenta existente.' };
        case 'auth/weak-password':
            return { title: 'Contraseña debil', message: 'La contraseña debe tener al menos 6 caracteres.' };
        case 'auth/user-not-found':
            return { title: 'Usuario no encontrado', message: 'No existe una cuenta con este correo. Verifica tu correo o regístrate.' };
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            return { title: 'Credenciales incorrectas', message: 'El correo o la contraseña son incorrectos. Intenta de nuevo.' };
        case 'auth/too-many-requests':
            return { title: 'Demasiados intentos', message: 'Has intentado demasiadas veces. Espera unos minutos antes de intentar de nuevo.' };
        case 'auth/cancelled-popup-request':
            return null;
        default:
            return { title: 'Error de autenticación', message: error.message };
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
        btnText.textContent = 'Iniciar Sesión';
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
        showNotification('Contraseña muy corta', 'La contraseña debe tener al menos 6 caracteres.', 'warning');
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
        showNotification('Correo requerido', 'Ingresa tu correo electrónico en el campo de email y luego haz clic en "Olvidaste tu contraseña?".', 'info');
        return;
    }
    window.firebaseAuth.sendPasswordResetEmail(window.auth, email).then(() => {
        showNotification('Correo enviado', `Se ha enviado un enlace de recuperación a ${email}. Revisa tu bandeja de entrada y carpeta de spam.`, 'success');
    }).catch((error) => {
        console.error('Error al enviar recuperación:', error);
        if (error.code === 'auth/user-not-found') {
            showNotification('Usuario no encontrado', 'No existe una cuenta con este correo electrónico.', 'error');
        } else {
            showNotification('Error', 'No se pudo enviar el correo de recuperación. Intenta de nuevo.', 'error');
        }
    });
}

function handleLogout() {
    // Cerrar cualquier modal abierto antes de mostrar el de logout
    document.querySelectorAll('.modal-overlay').forEach(m => {
        if (m.id !== 'logoutModal') m.classList.add('hidden');
    });
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
        console.error('Error al cerrar sesión:', error);
        showNotification('Error', 'No se pudo cerrar sesión. Intenta de nuevo.', 'error');
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
        // Usuario ya existe, cerrar sesión
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

// Crear organización (Gerente)
document.getElementById('orgForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const orgName = document.getElementById('orgName').value.trim();
    const orgIndustry = document.getElementById('orgIndustry').value.trim();
    const btnText = document.getElementById('orgBtnText');
    if (!orgName) {
        showNotification('Campo requerido', 'Ingresa el nombre de tu organización.', 'warning');
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
            'Organización creada',
            `Tu organización "${orgName}" fue creada exitosamente.\n\nCódigo de invitación: ${inviteCode}\n\nComparte este código con tu equipo para que se unan.`,
            'success'
        );
        await loadApp(currentUser.uid);
    } catch (error) {
        console.error('Error al crear organización:', error);
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) {
            showNotification(errorInfo.title, errorInfo.message, 'error');
        } else {
            showNotification('Error', 'No se pudo crear la organización: ' + error.message, 'error');
        }
        btnText.textContent = 'Crear Organización';
        pendingRegistration = null;
        window.suppressAuthRedirect = false;
    }
});

// Unirse a organización (Agente) - Crea usuario primero, luego valida código
document.getElementById('joinForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawCode = document.getElementById('inviteCode').value.trim();
    const inviteCode = rawCode.toUpperCase().replace(/\s/g, '');
    const btnText = document.getElementById('joinBtnText');

    if (!inviteCode || inviteCode.length < 5) {
        showNotification('Código inválido', 'Ingresa un código de invitación válido (formato XXXXX-XXXXX).', 'warning');
        return;
    }

    btnText.innerHTML = '<span class="spinner"></span>';
    let userWasCreated = false;

    try {
        // PRIMERO: crear usuario si hay registro pendiente (necesario para consultar Firestore)
        if (pendingRegistration) {
            await createPendingUser();
            userWasCreated = true;
        }

        // SEGUNDO: validar código de invitación (requiere autenticación)
        const orgsRef = window.firestore.collection(window.db, 'organizations');
        const orgsQuery = window.firestore.query(orgsRef, window.firestore.where('inviteCode', '==', inviteCode));
        const orgsSnapshot = await window.firestore.getDocs(orgsQuery);

        if (orgsSnapshot.empty) {
            // Código inválido: eliminar usuario recién creado si aplica
            if (userWasCreated && currentUser) {
                try {
                    await window.firebaseAuth.deleteUser(currentUser);
                } catch (delErr) {
                    console.error('Error al eliminar usuario tras código inválido:', delErr);
                }
                currentUser = null;
            }
            showNotification('Código no encontrado', 'El código de invitación ingresado no corresponde a ninguna organización. Verifica el código con tu gerente.', 'error');
            btnText.textContent = 'Unirse a la Organización';
            pendingRegistration = null;
            window.suppressAuthRedirect = false;
            showOnboardingPage();
            return;
        }

        const orgDoc = orgsSnapshot.docs[0];
        const orgData = orgDoc.data();
        const orgId = orgDoc.id;

        // Verificar si el usuario ya es miembro
        if (orgData.members && orgData.members.includes(currentUser.uid)) {
            showNotification('Ya eres miembro', 'Ya perteneces a esta organización.', 'info');
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

        // Agregar usuario a la organización
        const updatedMembers = orgData.members ? [...orgData.members, currentUser.uid] : [currentUser.uid];
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', orgId),
            { members: updatedMembers }
        );

        // Crear documento del usuario
        const userName = currentUser.displayName || currentUser.email.split('@')[0];
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

        showNotification('Te uniste exitosamente', `Ahora eres parte de "${orgData.name}". ¡Bienvenido al equipo!`, 'success');
        await loadApp(currentUser.uid);
    } catch (error) {
        console.error('Error al unirse:', error);
        // Si se creó usuario pero falló después, limpiar
        if (userWasCreated && currentUser) {
            try {
                await window.firebaseAuth.deleteUser(currentUser);
            } catch (delErr) {
                console.error('Error al limpiar usuario:', delErr);
            }
            currentUser = null;
        }
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) {
            showNotification(errorInfo.title, errorInfo.message, 'error');
        } else {
            showNotification('Error', 'No se pudo unir a la organización. Intenta de nuevo.\n\nDetalle: ' + error.message, 'error');
        }
        btnText.textContent = 'Unirse a la Organización';
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
    document.getElementById('loginBtnText').textContent = 'Iniciar Sesión';
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
            showNotification('Error', 'No se encontró la organización. Contacta al administrador.', 'error');
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

        // Ocultar Integraciones y Agentes IA para agentes
        ['integrations', 'aiAgents'].forEach(navPage => {
            const navItem = document.querySelector(`.nav-item[data-page="${navPage}"]`);
            if (navItem) {
                navItem.style.display = userData.role === 'agente' ? 'none' : '';
            }
        });

        // Ocultar sección de personalización para agentes
        const brandingSection = document.getElementById('settingsBrandingSection');
        if (brandingSection) {
            brandingSection.style.display = userData.role === 'agente' ? 'none' : '';
        }

        // Aplicar branding personalizado
        applyBranding();

        await loadTeamMembers();
        await loadContacts();
        await loadConversations();
        loadOrders();
        if (userData.role !== 'agente') {
            await loadIntegrationConfigs();
            await loadKnowledgeBases();
            await loadAIAgents();
        }
        updateSettingsPage(userData);

        addAppNotification('Bienvenido', `Hola ${userName}, bienvenido a MessageHub.`, 'info');

        document.getElementById('appLayout').classList.add('active');
        showPageDirect('dashboard');
        updateDashboardCharts();
    } catch (error) {
        console.error('Error al cargar la app:', error);
        showNotification('Error', 'No se pudo cargar la aplicación. Intenta recargar la página.', 'error');
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
                <div class="team-status" title="En línea"></div>
            </div>
        `;
    }).join('');

    if (teamGrid) teamGrid.innerHTML = memberHTML;
    if (allTeamGrid) allTeamGrid.innerHTML = memberHTML;
    const teamCountEl = document.getElementById('teamCount');
    if (teamCountEl) teamCountEl.textContent = teamMembers.length;
}

// ========== NAVEGACION DE PAGINAS ==========

function showPage(page) {
    // Bloquear acceso a Integraciones y Agentes IA para agentes
    if ((page === 'integrations' || page === 'aiAgents') && currentUserData && currentUserData.role === 'agente') {
        showNotification('Acceso restringido', 'Esta sección solo está disponible para gerentes y administradores.', 'warning');
        return;
    }

    const pages = ['dashboard', 'conversations', 'contacts', 'orders', 'team', 'integrations', 'aiAgents', 'settings'];
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
        dashboard: { title: 'Panel Principal', subtitle: 'Resumen de tu actividad de mensajería' },
        conversations: { title: 'Conversaciones', subtitle: 'Gestiona todas tus conversaciones y funnel de ventas' },
        contacts: { title: 'Contactos', subtitle: 'Directorio de contactos enriquecido' },
        orders: { title: 'Pedidos', subtitle: 'Pedidos generados por el agente IA desde las conversaciones' },
        team: { title: 'Equipo', subtitle: 'Gestiona los miembros de tu equipo' },
        integrations: { title: 'Integraciones', subtitle: 'Conecta plataformas de mensajería y pasarelas de pago' },
        aiAgents: { title: 'Agentes IA', subtitle: 'Configura agentes de inteligencia artificial para tus canales' },
        settings: { title: 'Configuración', subtitle: 'Preferencias de la organización' }
    };

    if (titles[page]) {
        document.getElementById('pageTitle').textContent = titles[page].title;
        document.getElementById('pageSubtitle').textContent = titles[page].subtitle;
    }

    // Refrescar datos según la página
    if (page === 'dashboard') {
        updateDashboardCharts();
    } else if (page === 'conversations') {
        renderFunnel();
        loadConversations();
    } else if (page === 'orders') {
        loadOrders();
    } else if (page === 'integrations') {
        loadIntegrationConfigs();
    } else if (page === 'aiAgents') {
        loadKnowledgeBases();
        loadAIAgents();
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

// ========== GRÁFICAS DEL DASHBOARD ==========

let currentChartPeriod = 'today';

function setChartPeriod(period, btn) {
    currentChartPeriod = period;
    document.querySelectorAll('.chart-period-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const customDates = document.getElementById('chartCustomDates');
    if (period === 'custom') {
        customDates.classList.remove('hidden');
    } else {
        customDates.classList.add('hidden');
    }
    updateDashboardCharts();
}

function getChartDateRange() {
    const now = new Date();
    let from, to;
    to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    switch (currentChartPeriod) {
        case 'today':
            from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            break;
        case 'week':
            from = new Date(now);
            from.setDate(now.getDate() - now.getDay()); // Inicio de semana (domingo)
            from.setHours(0, 0, 0, 0);
            break;
        case 'month':
            from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
            break;
        case 'custom':
            const fromInput = document.getElementById('chartDateFrom').value;
            const toInput = document.getElementById('chartDateTo').value;
            if (fromInput) from = new Date(fromInput + 'T00:00:00');
            else from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            if (toInput) to = new Date(toInput + 'T23:59:59');
            break;
        default:
            from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    }
    return { from, to };
}

function updateDashboardCharts() {
    renderConversationsChart();
    renderFunnelChart();
}

function renderConversationsChart() {
    const chartEl = document.getElementById('convChart');
    const legendEl = document.getElementById('convChartLegend');
    if (!chartEl) return;

    const { from, to } = getChartDateRange();

    // Filtrar conversaciones por periodo
    const filtered = conversations.filter(c => {
        const date = c.lastMessageAt ? (c.lastMessageAt.toDate ? c.lastMessageAt.toDate() : new Date(c.lastMessageAt)) : null;
        return date && date >= from && date <= to;
    });

    // Contar por plataforma
    const platforms = { whatsapp: 0, instagram: 0, messenger: 0, manual: 0 };
    filtered.forEach(c => {
        const p = c.platform || 'manual';
        platforms[p] = (platforms[p] || 0) + 1;
    });

    const total = filtered.length;
    const platformData = [
        { key: 'whatsapp', label: 'WhatsApp', color: '#25D366', count: platforms.whatsapp },
        { key: 'instagram', label: 'Instagram', color: '#E4405F', count: platforms.instagram },
        { key: 'messenger', label: 'Messenger', color: '#0084FF', count: platforms.messenger },
        { key: 'manual', label: 'Manual', color: '#8B5CF6', count: platforms.manual }
    ].filter(p => p.count > 0);

    if (total === 0) {
        chartEl.innerHTML = '<div class="chart-empty">Sin conversaciones en este periodo</div>';
        legendEl.innerHTML = '';
        return;
    }

    // Barras horizontales
    const maxCount = Math.max(...platformData.map(p => p.count));
    chartEl.innerHTML = `
        <div class="chart-total">
            <span class="chart-total-number">${total}</span>
            <span class="chart-total-label">conversaciones</span>
        </div>
        <div class="chart-bars">
            ${platformData.map(p => {
                const pct = Math.round((p.count / maxCount) * 100);
                return `
                    <div class="chart-bar-row">
                        <span class="chart-bar-label">${p.label}</span>
                        <div class="chart-bar-track">
                            <div class="chart-bar-fill" style="width:${pct}%;background:${p.color}"></div>
                        </div>
                        <span class="chart-bar-value">${p.count}</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    legendEl.innerHTML = platformData.map(p =>
        `<span class="chart-legend-item"><span class="chart-legend-dot" style="background:${p.color}"></span>${p.label}: ${p.count}</span>`
    ).join('');
}

function renderFunnelChart() {
    const chartEl = document.getElementById('funnelChart');
    const legendEl = document.getElementById('funnelChartLegend');
    if (!chartEl) return;

    // Contar contactos por etapa
    const stageCounts = {};
    FUNNEL_STAGES.forEach(s => { stageCounts[s.id] = 0; });
    contacts.forEach(c => {
        const stage = c.funnelStage || 'curioso';
        if (stageCounts[stage] !== undefined) stageCounts[stage]++;
    });

    const total = contacts.length;

    if (total === 0) {
        chartEl.innerHTML = '<div class="chart-empty">Sin contactos en el funnel</div>';
        legendEl.innerHTML = '';
        return;
    }

    // Barras del funnel (forma de embudo)
    const maxCount = Math.max(...Object.values(stageCounts), 1);
    chartEl.innerHTML = `
        <div class="chart-total">
            <span class="chart-total-number">${total}</span>
            <span class="chart-total-label">contactos</span>
        </div>
        <div class="chart-funnel-bars">
            ${FUNNEL_STAGES.map(stage => {
                const count = stageCounts[stage.id];
                const pct = Math.round((count / maxCount) * 100);
                return `
                    <div class="chart-bar-row">
                        <span class="chart-bar-label">${stage.name}</span>
                        <div class="chart-bar-track">
                            <div class="chart-bar-fill" style="width:${pct}%;background:${stage.color}"></div>
                        </div>
                        <span class="chart-bar-value">${count}</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    legendEl.innerHTML = FUNNEL_STAGES.map(s =>
        `<span class="chart-legend-item"><span class="chart-legend-dot" style="background:${s.color}"></span>${s.name}: ${stageCounts[s.id]}</span>`
    ).join('');
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
            body.innerHTML = '<div class="funnel-empty">Arrastra contactos aquí</div>';
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
                        <button class="funnel-card-btn" onclick="openConvFromFunnel('${contact.id}')" title="Ver conversación">💬</button>
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
    if (days === 1) return '1 día';
    return `${days} días`;
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

function openConvFromFunnel(contactId) {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    // Buscar conversación del contacto (por contactId o por teléfono)
    const conv = conversations.find(c => c.contactId === contactId) ||
                 conversations.find(c => contact.phone && c.contactPhone === contact.phone);

    if (!conv) {
        showNotification('Sin conversación', `No hay conversaciones registradas para ${contact.name}.`, 'info');
        return;
    }

    // El funnel está en la misma página de conversaciones; abrir directamente sin recargar
    openConversation(conv.id);
}

// ========== PEDIDOS ==========

async function loadOrders() {
    if (!currentOrganization) return;
    try {
        const ref = window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'orders');
        const q   = window.firestore.query(ref, window.firestore.orderBy('createdAt', 'desc'));
        const snap = await window.firestore.getDocs(q);
        orders = [];
        snap.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
        renderOrdersTable();
        renderOrdersBadge();
    } catch (err) {
        console.error('Error cargando pedidos:', err);
    }
}

function renderOrdersBadge() {
    const badge = document.getElementById('ordersBadge');
    if (badge) {
        const nuevos = orders.filter(o => o.status === 'nuevo').length;
        badge.textContent = nuevos;
        badge.classList.toggle('hidden', nuevos === 0);
    }

    const el = document.getElementById('statOrdersTotal');
    if (el) el.textContent = orders.length;
    const elN = document.getElementById('statOrdersNuevos');
    if (elN) elN.textContent = orders.filter(o => o.status === 'nuevo').length;
    const elP = document.getElementById('statOrdersEnProceso');
    if (elP) elP.textContent = orders.filter(o => o.status === 'en_proceso' || o.status === 'confirmado').length;

    const confirmedRevenue = orders
        .filter(o => o.status === 'entregado' || o.status === 'confirmado')
        .reduce((s, o) => s + (o.total || 0), 0);
    const revenueStr = '$' + confirmedRevenue.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

    const elR = document.getElementById('statOrdersRevenue');
    if (elR) elR.textContent = revenueStr;

    // Update dashboard summary cards
    const dashRevenue = document.getElementById('statDashRevenue');
    if (dashRevenue) dashRevenue.textContent = revenueStr;
    const dashOrders = document.getElementById('statDashOrders');
    if (dashOrders) dashOrders.textContent = orders.filter(o => ['nuevo','confirmado','en_proceso'].includes(o.status)).length;
}

function setOrderFilter(filter, btn) {
    currentOrderFilter = filter;
    document.querySelectorAll('.orders-filter').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderOrdersTable();
}

const ORDER_STATUS_LABELS = {
    nuevo: 'Nuevo', pago_pendiente: 'Pendiente de Pago', confirmado: 'Confirmado', en_proceso: 'En proceso',
    entregado: 'Entregado', cancelado: 'Cancelado'
};

const ORDER_PLATFORM_ICONS = { whatsapp: '📱', instagram: '📷', messenger: '💬', manual: '✉️' };

function renderOrdersTable() {
    const container = document.getElementById('ordersTableBody');
    const empty     = document.getElementById('ordersEmptyState');
    if (!container) return;

    const filtered = currentOrderFilter === 'all'
        ? orders
        : orders.filter(o => o.status === currentOrderFilter);

    if (filtered.length === 0) {
        container.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    container.innerHTML = filtered.map(order => {
        const status      = order.status || 'nuevo';
        const statusLabel = ORDER_STATUS_LABELS[status] || status;
        const total       = (order.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const clientName  = escapeHtml(order.contactCompany || order.contactName || 'Cliente sin nombre');
        const orderNum    = escapeHtml(order.orderNumber || ('#' + order.id.slice(-6).toUpperCase()));

        // Date
        let dateStr = '';
        if (order.createdAt) {
            const d = order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
            dateStr = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
        }

        // Items
        const items = order.items || [];
        const itemsHtml = items.length > 0
            ? items.map(item => {
                const qty    = Number(item.quantity) || 1;
                const name   = escapeHtml(item.product || item.notes || '—');
                const sku    = item.sku ? escapeHtml(item.sku) : '';
                const unitP  = item.unitPrice ? Number(item.unitPrice) : null;
                const lineT  = unitP ? (qty * unitP).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
                const unitStr= unitP ? `<span class="oitem-unit-price">$${unitP.toLocaleString('es-MX', { minimumFractionDigits: 2 })}/u</span>` : '';
                const priceStr = lineT ? `<span class="oitem-price">$${lineT}</span>` : '';
                return `<div class="order-card-item">
                    ${sku ? `<span class="oitem-sku">${sku}</span>` : ''}
                    <span class="oitem-qty">${qty}×</span>
                    <span class="oitem-name">${name}</span>
                    ${unitStr}${priceStr}
                </div>`;
            }).join('')
            : '<div class="order-card-item-empty">Sin artículos</div>';

        // Action buttons
        const btnConv = order.conversationId
            ? `<button class="btn-order-action" title="Abrir conversación" onclick="openConvFromOrder('${order.conversationId}')">💬</button>`
            : '';
        const btnPay = (status === 'nuevo' || status === 'pago_pendiente')
            ? `<button class="btn-order-action btn-order-pay" title="Enviar liga de pago" onclick="sendPaymentLinkFromOrder('${order.id}')">💳</button>`
            : '';

        const statusSelect = `
            <select class="conv-stage-select order-status-select" onchange="updateOrderStatus('${order.id}', this.value)">
                ${['nuevo','pago_pendiente','confirmado','en_proceso','entregado','cancelado'].map(s =>
                    `<option value="${s}" ${s === status ? 'selected' : ''}>${ORDER_STATUS_LABELS[s]}</option>`
                ).join('')}
            </select>`;

        return `
        <div class="order-card ${status}">
            <div class="order-card-header">
                <div class="order-card-meta">
                    <span class="order-card-num">${orderNum}</span>
                    ${dateStr ? `<span class="order-card-date">${dateStr}</span>` : ''}
                </div>
                <div class="order-card-status-wrap">
                    <span class="order-status ${status}">${statusLabel}</span>
                    ${statusSelect}
                </div>
            </div>
            <div class="order-card-client">
                <div class="order-card-client-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <span>${clientName}</span>
            </div>
            <div class="order-card-items">${itemsHtml}</div>
            <div class="order-card-footer">
                <div class="order-card-total">
                    <span class="order-card-total-label">Total</span>
                    <span class="order-card-total-amount">$${total}</span>
                </div>
                <div class="order-card-actions">${btnConv}${btnPay}</div>
            </div>
        </div>`;
    }).join('');
}

async function updateOrderStatus(orderId, newStatus) {
    try {
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'orders', orderId),
            { status: newStatus, updatedAt: window.firestore.serverTimestamp() }
        );
        const order = orders.find(o => o.id === orderId);
        if (order) order.status = newStatus;
        renderOrdersBadge();
    } catch (err) {
        console.error('Error actualizando pedido:', err);
        showNotification('Error', 'No se pudo actualizar el estado del pedido.', 'error');
    }
}

function openConvFromOrder(conversationId) {
    if (!conversationId) return;
    // If already on conversations page and conversations are loaded, open directly
    if (document.getElementById('conversationsPage') && !document.getElementById('conversationsPage').classList.contains('hidden')) {
        const conv = conversations.find(c => c.id === conversationId);
        if (conv) { openConversation(conversationId); return; }
    }
    pendingConvToOpen = conversationId;
    showPage('conversations');
}

function sendPaymentLinkFromOrder(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order || !order.conversationId) {
        showNotification('Sin conversación', 'Este pedido no tiene una conversación asociada.', 'warning');
        return;
    }
    // Store payment pre-fill data; open conversation which will trigger the modal
    pendingOrderPaymentLinkData = {
        total: order.total || 0,
        description: `Pedido ${order.orderNumber || order.id.slice(-6)}`,
        orderId: order.id
    };
    openConvFromOrder(order.conversationId);
}

async function generateOrderNumber() {
    const snap = await window.firestore.getDocs(
        window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'orders')
    );
    return 'PED-' + String(snap.size + 1).padStart(5, '0');
}

async function createOrderFromAI(orderData) {
    if (!currentOrganization) return { success: false, message: 'No hay organización activa.' };

    const items = (orderData.items || []).map(item => ({
        product:   String(item.product   || ''),
        sku:       String(item.sku       || ''),
        quantity:  Number(item.quantity)  || 1,
        unitPrice: Number(item.unitPrice) || 0,
        notes:     String(item.notes     || '')
    }));

    const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    const orderNumber = await generateOrderNumber();

    // Resolve contact company name from contacts array
    const contactId = currentConversation?.contactId || null;
    const contact = contactId ? contacts.find(c => c.id === contactId) : null;
    const contactCompany = contact?.company || null;
    const contactName = contact?.name || currentConversation?.contactName || orderData.contactName || 'Cliente';

    const order = {
        orderNumber,
        contactId,
        contactName,
        contactCompany,
        conversationId: currentConversation?.id  || null,
        platform:       currentConversation?.platform || 'manual',
        items,
        total,
        status:    'nuevo',
        notes:     orderData.notes || '',
        createdAt: window.firestore.serverTimestamp(),
        updatedAt: window.firestore.serverTimestamp(),
        createdBy: 'ai'
    };

    try {
        const docRef = await window.firestore.addDoc(
            window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'orders'),
            order
        );
        orders.unshift({ id: docRef.id, ...order, createdAt: new Date(), updatedAt: new Date() });
        renderOrdersBadge();
        return { success: true, orderNumber, orderId: docRef.id, total };
    } catch (err) {
        console.error('Error creando pedido desde IA:', err);
        return { success: false, message: err.message };
    }
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

        const _sc = document.getElementById('statContacts'); if (_sc) _sc.textContent = contacts.length;
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
                        <p>No hay contactos aún. Agrega tu primer contacto.</p>
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
                <td><strong><a href="#" class="contact-name-link" onclick="event.preventDefault(); openContactDetail('${contact.id}')">${escapeHtml(contact.name)}</a></strong></td>
                <td>${escapeHtml(contact.company || '--')}</td>
                <td>${escapeHtml(contact.phone || '--')}</td>
                <td>${escapeHtml(contact.email || '--')}</td>
                <td>${escapeHtml(contact.rfc || '--')}</td>
                <td><span class="${stageClass}">${stageName}</span></td>
                <td class="contacts-actions">
                    <button class="btn-table-action" onclick="openContactDetail('${contact.id}')" title="Ver detalle">👤</button>
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
        (c.rfc && c.rfc.toLowerCase().includes(q)) ||
        (c.razonSocial && c.razonSocial.toLowerCase().includes(q)) ||
        (c.ciudad && c.ciudad.toLowerCase().includes(q))
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
                <td><strong><a href="#" class="contact-name-link" onclick="event.preventDefault(); openContactDetail('${contact.id}')">${escapeHtml(contact.name)}</a></strong></td>
                <td>${escapeHtml(contact.company || '--')}</td>
                <td>${escapeHtml(contact.phone || '--')}</td>
                <td>${escapeHtml(contact.email || '--')}</td>
                <td>${escapeHtml(contact.rfc || '--')}</td>
                <td><span class="${stageClass}">${stageName}</span></td>
                <td class="contacts-actions">
                    <button class="btn-table-action" onclick="openContactDetail('${contact.id}')" title="Ver detalle">👤</button>
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
        document.getElementById('contactRazonSocial').value = contact.razonSocial || '';
        document.getElementById('contactRegimenFiscal').value = contact.regimenFiscal || '';
        document.getElementById('contactCodigoPostal').value = contact.codigoPostal || '';
        document.getElementById('contactCiudad').value = contact.ciudad || '';
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
        razonSocial: document.getElementById('contactRazonSocial').value.trim(),
        regimenFiscal: document.getElementById('contactRegimenFiscal').value.trim(),
        codigoPostal: document.getElementById('contactCodigoPostal').value.trim(),
        ciudad: document.getElementById('contactCiudad').value.trim(),
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

        const _sc = document.getElementById('statContacts'); if (_sc) _sc.textContent = contacts.length;
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
        const _sc = document.getElementById('statContacts'); if (_sc) _sc.textContent = contacts.length;
        renderContactsTable();
        renderFunnel();
        showNotification('Contacto eliminado', `${contact.name} fue eliminado del directorio.`, 'success');
    } catch (error) {
        console.error('Error al eliminar contacto:', error);
        showNotification('Error', 'No se pudo eliminar el contacto.', 'error');
    }
}

// ========== DETALLE DE CONTACTO ==========

function openContactDetail(contactId) {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    const modal = document.getElementById('contactDetailModal');
    const body = document.getElementById('contactDetailBody');

    const stageName = getStageName(contact.funnelStage || 'curioso');
    const stageClass = 'stage-badge stage-' + (contact.funnelStage || 'curioso');

    // Find related conversations and orders
    const contactConvs = conversations.filter(c => c.contactId === contactId);
    const contactOrders = orders.filter(o => o.contactId === contactId);

    const convsHtml = contactConvs.length > 0
        ? contactConvs.map(c => `<div class="contact-detail-conv-item" onclick="closeContactDetail(); showPage('conversations'); setTimeout(() => openConversation('${c.id}'), 300)">
            <span>${getPlatformIcon(c.platform)}</span>
            <span>${escapeHtml(c.lastMessage || 'Sin mensajes')}</span>
            <span class="contact-detail-conv-time">${c.lastMessageAt ? formatTimeAgo(c.lastMessageAt.toDate ? c.lastMessageAt.toDate() : new Date(c.lastMessageAt)) : ''}</span>
        </div>`).join('')
        : '<p class="contact-detail-empty-text">Sin conversaciones</p>';

    const ordersHtml = contactOrders.length > 0
        ? contactOrders.map(o => {
            const statusLabel = ORDER_STATUS_LABELS[o.status] || o.status;
            return `<div class="contact-detail-order-item">
                <span class="contact-detail-order-num">${escapeHtml(o.orderNumber || o.id.slice(-6))}</span>
                <span class="order-status ${o.status}">${statusLabel}</span>
                <span>$${(o.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
            </div>`;
        }).join('')
        : '<p class="contact-detail-empty-text">Sin pedidos</p>';

    const createdStr = contact.createdAt
        ? (contact.createdAt.toDate ? contact.createdAt.toDate() : new Date(contact.createdAt)).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
        : '--';

    body.innerHTML = `
        <div class="contact-detail-header-section">
            <div class="contact-detail-avatar">${escapeHtml((contact.name || '?')[0].toUpperCase())}</div>
            <div class="contact-detail-main-info">
                <h2 class="contact-detail-name">${escapeHtml(contact.name)}</h2>
                <span class="${stageClass}">${stageName}</span>
            </div>
        </div>

        <div class="contact-detail-grid">
            <div class="contact-detail-section">
                <h4 class="contact-detail-section-title">Informacion General</h4>
                <div class="contact-detail-field">
                    <label>Empresa</label>
                    <input type="text" class="form-input" id="cdField_company" value="${escapeHtml(contact.company || '')}" placeholder="Sin empresa">
                </div>
                <div class="contact-detail-field">
                    <label>Celular</label>
                    <input type="tel" class="form-input" id="cdField_phone" value="${escapeHtml(contact.phone || '')}" placeholder="Sin celular">
                </div>
                <div class="contact-detail-field">
                    <label>Correo Electronico</label>
                    <input type="email" class="form-input" id="cdField_email" value="${escapeHtml(contact.email || '')}" placeholder="Sin correo">
                </div>
            </div>

            <div class="contact-detail-section">
                <h4 class="contact-detail-section-title">Datos Fiscales y Direccion</h4>
                <div class="contact-detail-field">
                    <label>RFC</label>
                    <input type="text" class="form-input" id="cdField_rfc" value="${escapeHtml(contact.rfc || '')}" placeholder="XAXX010101000">
                </div>
                <div class="contact-detail-field">
                    <label>Razon Social</label>
                    <input type="text" class="form-input" id="cdField_razonSocial" value="${escapeHtml(contact.razonSocial || '')}" placeholder="Razon social para facturacion">
                </div>
                <div class="contact-detail-field">
                    <label>Regimen Fiscal</label>
                    <input type="text" class="form-input" id="cdField_regimenFiscal" value="${escapeHtml(contact.regimenFiscal || '')}" placeholder="Ej: 601 - General de Ley">
                </div>
                <div class="contact-detail-field">
                    <label>Direccion</label>
                    <textarea class="form-input form-textarea" id="cdField_address" rows="2" placeholder="Calle, Colonia, Ciudad, CP">${escapeHtml(contact.address || '')}</textarea>
                </div>
                <div class="contact-detail-field">
                    <label>Codigo Postal</label>
                    <input type="text" class="form-input" id="cdField_codigoPostal" value="${escapeHtml(contact.codigoPostal || '')}" placeholder="00000">
                </div>
                <div class="contact-detail-field">
                    <label>Ciudad / Estado</label>
                    <input type="text" class="form-input" id="cdField_ciudad" value="${escapeHtml(contact.ciudad || '')}" placeholder="Ciudad, Estado">
                </div>
            </div>

            <div class="contact-detail-section">
                <h4 class="contact-detail-section-title">Etapa del Funnel</h4>
                <div class="contact-detail-field">
                    <select class="form-input form-select" id="cdField_funnelStage">
                        ${FUNNEL_STAGES.map(s => `<option value="${s.id}" ${contact.funnelStage === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div class="contact-detail-section">
                <h4 class="contact-detail-section-title">Notas</h4>
                <div class="contact-detail-field">
                    <textarea class="form-input form-textarea" id="cdField_notes" rows="3" placeholder="Notas sobre este contacto...">${escapeHtml(contact.notes || '')}</textarea>
                </div>
            </div>
        </div>

        <div class="contact-detail-related">
            <div class="contact-detail-related-section">
                <h4 class="contact-detail-section-title">Conversaciones (${contactConvs.length})</h4>
                ${convsHtml}
            </div>
            <div class="contact-detail-related-section">
                <h4 class="contact-detail-section-title">Pedidos (${contactOrders.length})</h4>
                ${ordersHtml}
            </div>
        </div>

        <div class="contact-detail-footer-info">
            <span>Contacto creado: ${createdStr}</span>
            <span>ID: ${contact.id}</span>
        </div>
    `;

    document.getElementById('contactDetailSaveBtn').onclick = () => saveContactDetail(contactId);
    modal.classList.remove('hidden');
}

function closeContactDetail() {
    document.getElementById('contactDetailModal').classList.add('hidden');
}

async function saveContactDetail(contactId) {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact || !currentOrganization) return;

    const updateData = {
        company: document.getElementById('cdField_company').value.trim(),
        phone: document.getElementById('cdField_phone').value.trim(),
        email: document.getElementById('cdField_email').value.trim(),
        rfc: document.getElementById('cdField_rfc').value.trim().toUpperCase(),
        razonSocial: document.getElementById('cdField_razonSocial').value.trim(),
        regimenFiscal: document.getElementById('cdField_regimenFiscal').value.trim(),
        address: document.getElementById('cdField_address').value.trim(),
        codigoPostal: document.getElementById('cdField_codigoPostal').value.trim(),
        ciudad: document.getElementById('cdField_ciudad').value.trim(),
        funnelStage: document.getElementById('cdField_funnelStage').value,
        notes: document.getElementById('cdField_notes').value.trim(),
        updatedAt: window.firestore.serverTimestamp()
    };

    try {
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'contacts', contactId),
            updateData
        );

        const idx = contacts.findIndex(c => c.id === contactId);
        if (idx !== -1) {
            contacts[idx] = { ...contacts[idx], ...updateData, updatedAt: new Date() };
        }

        renderContactsTable();
        renderFunnel();
        closeContactDetail();
        showNotification('Contacto actualizado', `La informacion de ${contact.name} fue guardada correctamente.`, 'success');
    } catch (error) {
        console.error('Error guardando detalle del contacto:', error);
        showNotification('Error', 'No se pudo guardar: ' + error.message, 'error');
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
        addAppNotification('Código copiado', 'El código de invitación fue copiado al portapapeles.', 'success');
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
        { name: 'Agentes IA', page: 'aiAgents', icon: '🤖' },
        { name: 'Configuración', page: 'settings', icon: '⚙️' },
    ];

    pages.forEach(p => {
        // Ocultar Integraciones y Agentes IA de búsqueda para agentes
        if ((p.page === 'integrations' || p.page === 'aiAgents') && currentUserData && currentUserData.role === 'agente') return;
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

    let actions = [
        { name: 'Invitar Miembro', action: 'openInviteModal()', icon: '➕' },
        { name: 'Agregar Contacto', action: 'openContactModal()', icon: '📇' },
        { name: 'Cerrar Sesión', action: 'handleLogout()', icon: '🚪' },
        { name: 'Ayuda', action: 'openHelpModal()', icon: '❓' },
        { name: 'Mi Perfil', action: 'openProfileModal()', icon: '👤' },
        { name: 'WhatsApp', action: "openIntegrationConfig('whatsapp')", icon: '📱' },
        { name: 'Instagram', action: "openIntegrationConfig('instagram')", icon: '📷' },
        { name: 'Messenger', action: "openIntegrationConfig('messenger')", icon: '💬' },
        { name: 'Stripe', action: "openIntegrationConfig('stripe')", icon: '💳' },
        { name: 'MercadoPago', action: "openIntegrationConfig('mercadopago')", icon: '🏦' },
    ];

    // Filtrar acciones de integración para agentes
    if (currentUserData && currentUserData.role === 'agente') {
        const integrationActions = ['WhatsApp', 'Instagram', 'Messenger', 'Stripe', 'MercadoPago'];
        actions = actions.filter(a => !integrationActions.includes(a.name));
    }

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
                    <span>${r.icon}</span><span>${r.name}</span><span class="search-result-type">Página</span>
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
                    <span>${r.icon}</span><span>${r.name}</span><span class="search-result-type">Acción</span>
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

        // Branding fields
        const brandInput = document.getElementById('brandNameInput');
        if (brandInput) brandInput.value = currentOrganization.brandName || '';

        const logoImg = document.getElementById('logoPreviewImg');
        const logoPlaceholder = document.getElementById('logoPreviewPlaceholder');
        const removeLogoBtn = document.getElementById('removeLogoBtn');
        if (currentOrganization.customLogo) {
            logoImg.src = currentOrganization.customLogo;
            logoImg.classList.remove('hidden');
            logoPlaceholder.classList.add('hidden');
            if (removeLogoBtn) removeLogoBtn.classList.remove('hidden');
        }

        const iconImg = document.getElementById('iconPreviewImg');
        const iconPlaceholder = document.getElementById('iconPreviewPlaceholder');
        const removeIconBtn = document.getElementById('removeIconBtn');
        if (currentOrganization.customIcon) {
            iconImg.src = currentOrganization.customIcon;
            iconImg.classList.remove('hidden');
            iconPlaceholder.classList.add('hidden');
            if (removeIconBtn) removeIconBtn.classList.remove('hidden');
        }
    }
}

function copySettingsInviteCode() {
    if (!currentOrganization || !currentOrganization.inviteCode) return;
    navigator.clipboard.writeText(currentOrganization.inviteCode).then(() => {
        addAppNotification('Código copiado', 'Código de invitación copiado al portapapeles.', 'success');
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = currentOrganization.inviteCode;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        addAppNotification('Código copiado', 'Código de invitación copiado al portapapeles.', 'success');
    });
}

// ========== INTEGRACIONES - CONFIGURACIÓN AUTOSERVICIO ==========

let currentIntegrationPlatform = null;
let integrationConfigs = {};

const INTEGRATION_FIELDS = {
    whatsapp: {
        title: 'Configurar WhatsApp Business',
        fields: [
            { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '123456789012345', hint: 'Lo encuentras en Meta Business Suite > WhatsApp > Configuración de API' },
            { key: 'accessToken', label: 'Access Token (temporal o permanente)', placeholder: 'EAAGx...', hint: 'Token de acceso de la API de WhatsApp Business', secret: true },
            { key: 'verifyToken', label: 'Webhook Verify Token', placeholder: 'mi_token_secreto', hint: 'Token que configurarás en el webhook de Meta. Puede ser cualquier texto que tú elijas.' },
            { key: 'appId', label: 'App ID de Meta', placeholder: '1234567890', hint: 'ID de tu aplicación en Meta for Developers' },
            { key: 'appSecret', label: 'App Secret', placeholder: 'abc123...', hint: 'Secreto de la app (se almacenará de forma segura)', secret: true }
        ],
        webhookNote: 'URL del Webhook (configúrala en Meta for Developers):'
    },
    instagram: {
        title: 'Configurar Instagram Direct',
        fields: [
            { key: 'pageId', label: 'Page ID de Facebook (vinculada a Instagram)', placeholder: '123456789', hint: 'ID de la página de Facebook conectada a tu cuenta de Instagram Business' },
            { key: 'accessToken', label: 'Page Access Token', placeholder: 'EAAGx...', hint: 'Token de acceso de la página con permisos de Instagram', secret: true },
            { key: 'appId', label: 'App ID de Meta', placeholder: '1234567890', hint: 'ID de tu aplicación en Meta for Developers' },
            { key: 'appSecret', label: 'App Secret', placeholder: 'abc123...', hint: 'Secreto de la app', secret: true }
        ],
        webhookNote: 'URL del Webhook (configúrala en Meta for Developers):'
    },
    messenger: {
        title: 'Configurar Messenger',
        fields: [
            { key: 'pageId', label: 'Page ID de Facebook', placeholder: '123456789', hint: 'ID de tu página de Facebook' },
            { key: 'accessToken', label: 'Page Access Token', placeholder: 'EAAGx...', hint: 'Token de acceso de la página con permisos de mensajes', secret: true },
            { key: 'appId', label: 'App ID de Meta', placeholder: '1234567890', hint: 'ID de tu aplicación en Meta for Developers' },
            { key: 'appSecret', label: 'App Secret', placeholder: 'abc123...', hint: 'Secreto de la app', secret: true }
        ],
        webhookNote: 'URL del Webhook (configúrala en Meta for Developers):'
    },
    stripe: {
        title: 'Configurar Stripe',
        fields: [
            { key: 'publishableKey', label: 'Publishable Key', placeholder: 'pk_live_...', hint: 'Clave pública de Stripe (Dashboard > Developers > API Keys)' },
            { key: 'secretKey', label: 'Secret Key', placeholder: 'sk_live_...', hint: 'Clave secreta (se almacenará de forma segura via Cloud Functions)', secret: true },
            { key: 'webhookSecret', label: 'Webhook Signing Secret', placeholder: 'whsec_...', hint: 'Para verificar webhooks de Stripe (opcional)', secret: true }
        ]
    },
    mercadopago: {
        title: 'Configurar MercadoPago',
        fields: [
            { key: 'publicKey', label: 'Public Key', placeholder: 'APP_USR-...', hint: 'Clave pública (Mercado Pago > Tu negocio > Credenciales)' },
            { key: 'accessToken', label: 'Access Token', placeholder: 'APP_USR-...', hint: 'Token de acceso (se almacenará de forma segura via Cloud Functions)', secret: true }
        ]
    }
};

function openIntegrationConfig(platform) {
    currentIntegrationPlatform = platform;
    const config = INTEGRATION_FIELDS[platform];
    if (!config) return;

    document.getElementById('integConfigTitle').textContent = config.title;

    const savedConfig = integrationConfigs[platform] || {};
    let html = '';

    // Webhook URL note para Meta
    if (config.webhookNote) {
        const WEBHOOK_NAMES = { whatsapp: 'whatsappWebhook', instagram: 'instagramWebhook', messenger: 'messengerWebhook' };
        const defaultUrl = `https://us-central1-crm-meta-e56f4.cloudfunctions.net/${WEBHOOK_NAMES[platform] || platform}`;
        const customUrl  = savedConfig.customWebhookUrl || '';
        const activeUrl  = customUrl || defaultUrl;
        html += `
            <div class="integ-webhook-note">
                <span class="integ-webhook-label">${config.webhookNote}</span>
                <div class="integ-webhook-url">
                    <code id="integWebhookDisplay">${escapeHtml(activeUrl)}</code>
                    <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('integWebhookDisplay').textContent)" title="Copiar">📋</button>
                </div>
                <div class="form-group integ-custom-url-group">
                    <label class="form-label">URL personalizada <span class="integ-field-optional">(opcional)</span></label>
                    <input type="url" class="form-input" id="integ_customWebhookUrl"
                           placeholder="${escapeHtml(defaultUrl)}"
                           value="${escapeHtml(customUrl)}"
                           oninput="const v=this.value.trim();document.getElementById('integWebhookDisplay').textContent=v||'${escapeHtml(defaultUrl)}'">
                    <span class="integ-field-hint">Deja vacío para usar la URL generada automáticamente. Útil si tu función tiene un nombre o proyecto diferente.</span>
                </div>
            </div>
        `;
    }

    config.fields.forEach(field => {
        const value = savedConfig[field.key] || '';
        const inputType = field.secret ? 'password' : 'text';
        const maskedNote = field.secret ? '<span class="integ-secret-note">Se almacenará de forma segura</span>' : '';
        html += `
            <div class="form-group">
                <label class="form-label">${field.label} ${maskedNote}</label>
                <input type="${inputType}" class="form-input" id="integ_${field.key}" placeholder="${field.placeholder}" value="${escapeHtml(value)}">
                <span class="integ-field-hint">${field.hint}</span>
            </div>
        `;
    });

    document.getElementById('integConfigBody').innerHTML = html;
    document.getElementById('integrationConfigModal').classList.remove('hidden');
}

function closeIntegrationConfig() {
    document.getElementById('integrationConfigModal').classList.add('hidden');
    currentIntegrationPlatform = null;
}

async function saveIntegrationConfig() {
    if (!currentIntegrationPlatform || !currentOrganization) return;

    const config = INTEGRATION_FIELDS[currentIntegrationPlatform];
    const data = {};
    let hasValue = false;

    config.fields.forEach(field => {
        const el = document.getElementById('integ_' + field.key);
        if (el) {
            data[field.key] = el.value.trim();
            if (data[field.key]) hasValue = true;
        }
    });

    // URL personalizada de webhook (campo especial, no en config.fields)
    const customUrlEl = document.getElementById('integ_customWebhookUrl');
    if (customUrlEl !== null) {
        data.customWebhookUrl = customUrlEl.value.trim();
        if (data.customWebhookUrl) hasValue = true;
    }

    if (!hasValue) {
        showNotification('Sin datos', 'Ingresa al menos un campo para guardar la configuración.', 'warning');
        return;
    }

    data.platform = currentIntegrationPlatform;
    data.configuredAt = window.firestore.serverTimestamp();
    data.configuredBy = currentUser.uid;

    try {
        await window.firestore.setDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'integrations', currentIntegrationPlatform),
            data,
            { merge: true }
        );

        integrationConfigs[currentIntegrationPlatform] = data;
        updateIntegrationStatus(currentIntegrationPlatform, true);
        closeIntegrationConfig();
        showNotification('Configuración guardada', `La configuración de ${getIntegrationName(currentIntegrationPlatform)} fue guardada correctamente.`, 'success');
    } catch (error) {
        console.error('Error guardando configuración:', error);
        showNotification('Error', 'No se pudo guardar la configuración: ' + error.message, 'error');
    }
}

function getIntegrationName(platform) {
    const names = { whatsapp: 'WhatsApp Business', instagram: 'Instagram Direct', messenger: 'Messenger', stripe: 'Stripe', mercadopago: 'MercadoPago' };
    return names[platform] || platform;
}

function updateIntegrationStatus(platform, connected) {
    const statusMap = { whatsapp: 'waStatus', instagram: 'igStatus', messenger: 'msgStatus', stripe: 'stripeStatus', mercadopago: 'mpStatus' };
    const statusEl = document.getElementById(statusMap[platform]);
    if (statusEl) {
        if (connected) {
            statusEl.innerHTML = '<span class="status-badge status-connected">Configurado</span>';
        } else {
            statusEl.innerHTML = '<span class="status-badge status-disconnected">Desconectado</span>';
        }
    }
    // Mostrar/ocultar botón de borrar
    const deleteBtn = document.getElementById('integDelete_' + platform);
    if (deleteBtn) {
        if (connected) {
            deleteBtn.classList.remove('hidden');
        } else {
            deleteBtn.classList.add('hidden');
        }
    }
}

async function deleteIntegrationConfig(platform) {
    if (!currentOrganization) return;
    if (!confirm(`¿Eliminar la configuración de ${getIntegrationName(platform)}? Se borrarán todas las credenciales almacenadas.`)) return;

    try {
        await window.firestore.deleteDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'integrations', platform)
        );
        delete integrationConfigs[platform];
        updateIntegrationStatus(platform, false);
        showNotification('Configuración eliminada', `La configuración de ${getIntegrationName(platform)} fue eliminada correctamente.`, 'success');
    } catch (error) {
        console.error('Error eliminando configuración:', error);
        showNotification('Error', 'No se pudo eliminar la configuración: ' + error.message, 'error');
    }
}

async function loadIntegrationConfigs() {
    if (!currentOrganization) return;
    try {
        const integRef = window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'integrations');
        const snapshot = await window.firestore.getDocs(integRef);
        snapshot.forEach(doc => {
            integrationConfigs[doc.id] = doc.data();
            updateIntegrationStatus(doc.id, true);
        });
    } catch (error) {
        console.error('Error cargando configuraciones de integración:', error);
    }
}

// ========== PEDIDOS ==========

let orders = [];
let currentOrderFilter = 'all';

// ========== SISTEMA DE CHAT / CONVERSACIONES ==========

let conversations = [];
let currentConversation = null;
let currentConvFilter = 'all';
let messagesUnsubscribe = null;
let selectedChatPlatform = null;
let selectedPaymentGateway = null;
let currentConvPaymentLinks = [];
let aiAgents = [];
let knowledgeBases = [];
let parsedExcelData = null;

// ===== CACHÉ DE KNOWLEDGE BASE (TTL 5 minutos) =====
const kbDataCache = {}; // { [kbId]: { rows: [...], loadedAt: timestamp } }
const KB_CACHE_TTL = 5 * 60 * 1000; // 5 minutos en ms
let parsedExcelWorkbook = null;

async function loadConversations() {
    if (!currentOrganization) return;

    try {
        const convsRef = window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'conversations');
        const convsQuery = window.firestore.query(convsRef, window.firestore.orderBy('lastMessageAt', 'desc'));
        const snapshot = await window.firestore.getDocs(convsQuery);
        conversations = [];
        snapshot.forEach(doc => {
            conversations.push({ id: doc.id, ...doc.data() });
        });
        renderConversationsList();
        document.getElementById('statConversations').textContent = conversations.filter(c => c.status === 'open').length;
        document.getElementById('convBadge').textContent = conversations.filter(c => c.status === 'open').length;
        // Auto-open conversation requested from another page (e.g. funnel, orders)
        if (pendingConvToOpen) {
            const convId = pendingConvToOpen;
            pendingConvToOpen = null;
            openConversation(convId);
        }
    } catch (error) {
        console.error('Error cargando conversaciones:', error);
    }
}

function renderConversationsList() {
    const body = document.getElementById('convListBody');
    if (!body) return;

    let filtered = conversations;
    if (currentConvFilter !== 'all') {
        filtered = conversations.filter(c => c.platform === currentConvFilter);
    }

    if (filtered.length === 0) {
        body.innerHTML = `
            <div class="conv-empty-list">
                <span>💬</span>
                <p>No hay conversaciones aún</p>
                <p class="conv-empty-hint">Haz clic en "+" para iniciar un nuevo chat</p>
            </div>
        `;
        return;
    }

    body.innerHTML = filtered.map(conv => {
        const platformIcon = getPlatformIcon(conv.platform);
        const isActive = currentConversation && currentConversation.id === conv.id;
        const timeStr = conv.lastMessageAt ? formatTimeAgo(conv.lastMessageAt.toDate ? conv.lastMessageAt.toDate() : new Date(conv.lastMessageAt)) : '';
        const stageBadge = conv.funnelStage ? `<span class="conv-stage-badge stage-${conv.funnelStage}">${getStageName(conv.funnelStage)}</span>` : '';
        const unreadClass = conv.unreadCount > 0 ? ' conv-item-unread' : '';

        return `
            <div class="conv-item${isActive ? ' active' : ''}${unreadClass}" onclick="openConversation('${conv.id}')">
                <div class="conv-item-avatar">${platformIcon}</div>
                <div class="conv-item-info">
                    <div class="conv-item-header">
                        <span class="conv-item-name">${escapeHtml(conv.contactName || 'Sin nombre')}</span>
                        <span class="conv-item-time">${timeStr}</span>
                    </div>
                    <div class="conv-item-preview">${escapeHtml(conv.lastMessage || 'Sin mensajes')}</div>
                    <div class="conv-item-meta">
                        <span class="conv-item-platform">${getPlatformLabel(conv.platform)}</span>
                        ${stageBadge}
                    </div>
                </div>
                ${conv.unreadCount > 0 ? `<span class="conv-item-badge">${conv.unreadCount}</span>` : ''}
                <button class="conv-item-delete" onclick="event.stopPropagation(); deleteConversation('${conv.id}')" title="Eliminar conversación">🗑️</button>
            </div>
        `;
    }).join('');
}

function getPlatformIcon(platform) {
    const icons = { whatsapp: '📱', instagram: '📷', messenger: '💬', manual: '✉️' };
    return icons[platform] || '💬';
}

function getPlatformLabel(platform) {
    const labels = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger', manual: 'Manual' };
    return labels[platform] || platform;
}

function filterConversations(query) {
    const body = document.getElementById('convListBody');
    if (!query || !query.trim()) {
        renderConversationsList();
        return;
    }
    const q = query.toLowerCase().trim();
    const filtered = conversations.filter(c =>
        (c.contactName && c.contactName.toLowerCase().includes(q)) ||
        (c.lastMessage && c.lastMessage.toLowerCase().includes(q))
    );

    if (currentConvFilter !== 'all') {
        const platformFiltered = filtered.filter(c => c.platform === currentConvFilter);
        renderFilteredConvs(platformFiltered, query);
    } else {
        renderFilteredConvs(filtered, query);
    }
}

function renderFilteredConvs(convs, query) {
    const body = document.getElementById('convListBody');
    if (convs.length === 0) {
        body.innerHTML = `<div class="conv-empty-list"><p>Sin resultados para "${escapeHtml(query)}"</p></div>`;
        return;
    }
    // Reuse the same rendering logic
    const oldConvs = conversations;
    conversations = convs;
    renderConversationsList();
    conversations = oldConvs;
}

function setConvFilter(filter, btn) {
    currentConvFilter = filter;
    document.querySelectorAll('.conv-filter').forEach(f => f.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderConversationsList();
}

// Abrir una conversación y cargar mensajes
async function openConversation(convId) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;

    currentConversation = conv;
    renderConversationsList();

    const panel = document.getElementById('convDetailPanel');
    panel.innerHTML = `
        <div class="conv-detail-header">
            <div class="conv-detail-contact">
                <span class="conv-detail-icon">${getPlatformIcon(conv.platform)}</span>
                <div>
                    <div class="conv-detail-name">${escapeHtml(conv.contactName || 'Sin nombre')}</div>
                    <div class="conv-detail-platform">${getPlatformLabel(conv.platform)} ${conv.funnelStage ? '· ' + getStageName(conv.funnelStage) : ''}</div>
                </div>
            </div>
            <div class="conv-detail-actions">
                <label class="ai-conv-toggle" title="Activar/desactivar IA para esta conversación">
                    <input type="checkbox" ${conv.aiEnabled ? 'checked' : ''} onchange="toggleConvAI('${conv.id}', this.checked)">
                    <span class="ai-conv-toggle-slider"></span>
                    <span class="ai-conv-toggle-label">🤖</span>
                </label>
                <select class="conv-stage-select" onchange="changeConvStage('${conv.id}', this.value)" title="Etapa del funnel">
                    <option value="">Sin etapa</option>
                    ${FUNNEL_STAGES.map(s => `<option value="${s.id}" ${conv.funnelStage === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                </select>
                <button class="btn-icon btn-sm btn-danger-icon" onclick="deleteConversation('${conv.id}')" title="Eliminar conversación">🗑️</button>
                <button class="btn-icon btn-sm" onclick="closeConversation()" title="Cerrar">✕</button>
            </div>
        </div>
        <div class="conv-messages" id="convMessages">
            <div class="conv-messages-loading"><span class="spinner"></span></div>
        </div>
        <div class="conv-composer">
            <button class="conv-composer-btn" onclick="openPaymentLinkModal()" title="Enviar liga de pago">💳</button>
            <input type="text" class="conv-composer-input" id="messageInput" placeholder="Escribe un mensaje..." onkeypress="if(event.key==='Enter')sendMessage()">
            <button class="conv-composer-send" onclick="sendMessage()" title="Enviar">➤</button>
        </div>
    `;

    // Marcar como leído
    if (conv.unreadCount > 0) {
        try {
            await window.firestore.updateDoc(
                window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'conversations', convId),
                { unreadCount: 0 }
            );
            conv.unreadCount = 0;
            renderConversationsList();
        } catch (err) { console.error('Error marcando leído:', err); }
    }

    loadMessages(convId);

    // If a payment link was requested from orders page, pre-fill and open the modal
    if (pendingOrderPaymentLinkData) {
        const { total, description, orderId } = pendingOrderPaymentLinkData;
        pendingOrderPaymentLinkData = null;
        pendingPaymentOrderId = orderId || null;
        setTimeout(() => {
            openPaymentLinkModal();
            const amountEl = document.getElementById('paymentLinkAmount');
            const descEl   = document.getElementById('paymentLinkDescription');
            if (amountEl) amountEl.value = total;
            if (descEl)   descEl.value   = description;
        }, 150);
    }
}

function closeConversation() {
    currentConversation = null;
    if (messagesUnsubscribe) {
        messagesUnsubscribe();
        messagesUnsubscribe = null;
    }
    const panel = document.getElementById('convDetailPanel');
    panel.innerHTML = `
        <div class="conv-detail-empty">
            <div class="conv-detail-empty-icon">💬</div>
            <h3>Selecciona una conversación</h3>
            <p>Elige una conversación de la lista para ver los mensajes</p>
        </div>
    `;
    renderConversationsList();
}

async function deleteConversation(convId) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;

    if (!confirm(`¿Eliminar la conversación con "${conv.contactName || 'Sin nombre'}"? Esta acción no se puede deshacer.`)) return;

    try {
        await window.firestore.deleteDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'conversations', convId)
        );
        conversations = conversations.filter(c => c.id !== convId);
        document.getElementById('statConversations').textContent = conversations.filter(c => c.status === 'open').length;
        document.getElementById('convBadge').textContent = conversations.filter(c => c.status === 'open').length;
        closeConversation();
        renderConversationsList();
        showNotification('Conversación eliminada', `La conversación con "${conv.contactName || 'Sin nombre'}" fue eliminada.`, 'success');
    } catch (error) {
        console.error('Error al eliminar conversación:', error);
        showNotification('Error', 'No se pudo eliminar la conversación.', 'error');
    }
}

async function loadMessages(convId) {
    if (messagesUnsubscribe) {
        messagesUnsubscribe();
        messagesUnsubscribe = null;
    }

    const messagesRef = window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'conversations', convId, 'messages');
    const messagesQuery = window.firestore.query(messagesRef, window.firestore.orderBy('timestamp', 'asc'));

    // Escuchar mensajes en tiempo real
    messagesUnsubscribe = window.firestore.onSnapshot(messagesQuery, (snapshot) => {
        const messagesContainer = document.getElementById('convMessages');
        if (!messagesContainer) return;

        const messages = [];
        snapshot.forEach(doc => messages.push({ id: doc.id, ...doc.data() }));

        if (messages.length === 0) {
            messagesContainer.innerHTML = '<div class="conv-messages-empty">No hay mensajes aún. ¡Envía el primero!</div>';
        } else {
            messagesContainer.innerHTML = messages.map(msg => {
                const isAgent = msg.sender === 'agent';
                const time = msg.timestamp ? formatMessageTime(msg.timestamp) : '';
                const senderName = isAgent ? (msg.senderName || 'Tú') : (currentConversation?.contactName || 'Contacto');

                // Mensaje especial de liga de pago
                if (msg.type === 'payment_link') {
                    const isPaid = msg.paymentStatus === 'paid';
                    const statusLabel = isPaid ? 'Pagado' : 'Pendiente';
                    const statusClass = isPaid ? 'payment-status-paid' : 'payment-status-pending';
                    const gatewayName = msg.paymentGateway === 'stripe' ? 'Stripe' : 'MercadoPago';
                    const markPaidBtn = !isPaid ? `<button class="payment-mark-paid-btn" onclick="markPaymentAsPaid('${msg.paymentLinkId}', '${msg.id}')">Confirmar Pago</button>` : '';

                    return `
                        <div class="conv-message conv-message-agent">
                            <div class="conv-message-bubble payment-link-bubble">
                                <div class="payment-link-header">
                                    <span class="payment-link-icon">💳</span>
                                    <span class="payment-link-title">Liga de Pago</span>
                                    <span class="payment-link-status ${statusClass}">${statusLabel}</span>
                                </div>
                                <div class="payment-link-amount">$${Number(msg.paymentAmount).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN</div>
                                <div class="payment-link-desc">${escapeHtml(msg.paymentDescription || '')}</div>
                                <div class="payment-link-gateway">${gatewayName}</div>
                                <div class="payment-link-ref">Ref: ${escapeHtml(msg.paymentTrackingRef || '')}</div>
                                ${markPaidBtn}
                                <div class="conv-message-time">${time}</div>
                            </div>
                        </div>
                    `;
                }

                return `
                    <div class="conv-message ${isAgent ? 'conv-message-agent' : 'conv-message-contact'}">
                        <div class="conv-message-bubble">
                            <div class="conv-message-sender">${escapeHtml(senderName)}</div>
                            <div class="conv-message-text">${escapeHtml(msg.text)}</div>
                            <div class="conv-message-time">${time}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Scroll al fondo
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, (error) => {
        console.error('Error escuchando mensajes:', error);
        const messagesContainer = document.getElementById('convMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '<div class="conv-messages-empty">Error cargando mensajes.</div>';
        }
    });
}

function formatMessageTime(timestamp) {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    if (isToday) return `${hours}:${minutes}`;
    return `${date.getDate()}/${date.getMonth() + 1} ${hours}:${minutes}`;
}

async function sendMessage() {
    if (!currentConversation || !currentOrganization) return;

    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.focus();

    const userName = currentUserData?.name || currentUser.displayName || currentUser.email.split('@')[0];

    try {
        // Agregar mensaje
        await window.firestore.addDoc(
            window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'conversations', currentConversation.id, 'messages'),
            {
                text: text,
                sender: 'agent',
                senderName: userName,
                senderUid: currentUser.uid,
                platform: currentConversation.platform,
                timestamp: window.firestore.serverTimestamp(),
                status: 'sent'
            }
        );

        // Actualizar última actividad de la conversación
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'conversations', currentConversation.id),
            {
                lastMessage: text,
                lastMessageAt: window.firestore.serverTimestamp(),
                lastMessageBy: currentUser.uid
            }
        );

        // Actualizar conteo local
        const convIdx = conversations.findIndex(c => c.id === currentConversation.id);
        if (convIdx !== -1) {
            conversations[convIdx].lastMessage = text;
            conversations[convIdx].lastMessageAt = new Date();
        }
        document.getElementById('statMessages').textContent = parseInt(document.getElementById('statMessages').textContent || '0') + 1;
    } catch (error) {
        console.error('Error enviando mensaje:', error);
        showNotification('Error', 'No se pudo enviar el mensaje: ' + error.message, 'error');
    }
}

// Cambiar etapa del funnel desde la conversación
async function changeConvStage(convId, newStage) {
    if (!currentOrganization) return;

    try {
        const updateData = {
            funnelStage: newStage || null,
            stageChangedAt: window.firestore.serverTimestamp()
        };
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'conversations', convId),
            updateData
        );

        const conv = conversations.find(c => c.id === convId);
        if (conv) {
            conv.funnelStage = newStage || null;
            conv.stageChangedAt = new Date();
        }

        // Sincronizar con contacto si existe
        if (conv && conv.contactId) {
            const contact = contacts.find(c => c.id === conv.contactId);
            if (contact && newStage) {
                await window.firestore.updateDoc(
                    window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'contacts', conv.contactId),
                    { funnelStage: newStage, stageChangedAt: window.firestore.serverTimestamp() }
                );
                contact.funnelStage = newStage;
                contact.stageChangedAt = new Date();
                renderFunnel();
                renderContactsTable();
            }
        }

        renderConversationsList();
        addAppNotification('Etapa actualizada', `Conversación movida a "${getStageName(newStage)}"`, 'success');
    } catch (error) {
        console.error('Error cambiando etapa:', error);
        showNotification('Error', 'No se pudo cambiar la etapa.', 'error');
    }
}

// ========== LIGAS DE PAGO ==========

function generateTrackingRef() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let ref = 'PAY-';
    for (let i = 0; i < 8; i++) {
        ref += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return ref;
}

function openPaymentLinkModal() {
    if (!currentConversation) {
        showNotification('Sin conversación', 'Abre una conversación primero para enviar una liga de pago.', 'warning');
        return;
    }

    // Verificar que hay al menos una pasarela configurada
    const hasStripe = integrationConfigs.stripe && integrationConfigs.stripe.publishableKey;
    const hasMercadoPago = integrationConfigs.mercadopago && integrationConfigs.mercadopago.publicKey;

    const contactInfo = document.getElementById('paymentLinkContact');
    contactInfo.innerHTML = `<span>Cliente: <strong>${escapeHtml(currentConversation.contactName || 'Sin nombre')}</strong></span>`;

    // Auto-detect active order for this conversation
    const activeOrder = orders.find(o => o.conversationId === currentConversation.id && (o.status === 'nuevo' || o.status === 'pago_pendiente'));
    const orderInfoEl = document.getElementById('paymentLinkOrderInfo');
    if (activeOrder) {
        const orderNum = activeOrder.orderNumber || ('#' + activeOrder.id.slice(-6).toUpperCase());
        pendingPaymentOrderId = activeOrder.id;
        if (orderInfoEl) {
            orderInfoEl.innerHTML = `<span class="payment-order-badge">Pedido activo: <strong>${escapeHtml(orderNum)}</strong> — $${(activeOrder.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN</span>`;
            orderInfoEl.classList.remove('hidden');
        }
    } else {
        pendingPaymentOrderId = null;
        if (orderInfoEl) {
            orderInfoEl.innerHTML = '';
            orderInfoEl.classList.add('hidden');
        }
    }

    // Mostrar hint sobre pasarelas no configuradas
    const hintEl = document.getElementById('paymentGatewayHint');
    if (!hasStripe && !hasMercadoPago) {
        hintEl.textContent = 'Ninguna pasarela configurada. La liga se generará como referencia manual para cobro externo.';
        hintEl.style.color = 'var(--accent)';
    } else {
        const configured = [];
        if (hasStripe) configured.push('Stripe');
        if (hasMercadoPago) configured.push('MercadoPago');
        hintEl.textContent = `Pasarelas configuradas: ${configured.join(', ')}`;
        hintEl.style.color = 'var(--text-tertiary)';
    }

    // Reset form
    document.getElementById('paymentLinkAmount').value = activeOrder ? (activeOrder.total || '') : '';
    document.getElementById('paymentLinkDescription').value = activeOrder ? `Pedido ${activeOrder.orderNumber || activeOrder.id.slice(-6)}` : '';
    document.getElementById('paymentLinkNotes').value = '';
    selectedPaymentGateway = null;
    document.querySelectorAll('input[name="paymentGateway"]').forEach(r => r.checked = false);
    document.querySelectorAll('#paymentLinkModal .platform-option-card').forEach(c => c.classList.remove('selected'));

    // Auto-select the first configured gateway
    if (hasStripe) {
        selectPaymentGateway('stripe');
    } else if (hasMercadoPago) {
        selectPaymentGateway('mercadopago');
    }

    document.getElementById('paymentLinkModal').classList.remove('hidden');
}

function closePaymentLinkModal() {
    document.getElementById('paymentLinkModal').classList.add('hidden');
    selectedPaymentGateway = null;
}

function selectPaymentGateway(gateway) {
    selectedPaymentGateway = gateway;
    document.querySelectorAll('#paymentLinkModal .platform-option-card').forEach(c => c.classList.remove('selected'));
    const radio = document.querySelector(`input[name="paymentGateway"][value="${gateway}"]`);
    if (radio) {
        radio.checked = true;
        radio.closest('.platform-option').querySelector('.platform-option-card').classList.add('selected');
    }
}

async function sendPaymentLink() {
    if (!currentConversation || !currentOrganization) return;

    const amount = parseFloat(document.getElementById('paymentLinkAmount').value);
    const description = document.getElementById('paymentLinkDescription').value.trim();
    const notes = document.getElementById('paymentLinkNotes').value.trim();

    if (!amount || amount <= 0) {
        showNotification('Monto requerido', 'Ingresa un monto válido mayor a 0.', 'warning');
        return;
    }

    if (!description) {
        showNotification('Descripción requerida', 'Ingresa una descripción o concepto del pago.', 'warning');
        return;
    }

    if (!selectedPaymentGateway) {
        showNotification('Pasarela requerida', 'Selecciona una pasarela de pago.', 'warning');
        return;
    }

    const trackingRef = generateTrackingRef();
    const userName = currentUserData?.name || currentUser.displayName || currentUser.email.split('@')[0];

    try {
        // 1. Crear registro de liga de pago en Firestore
        const paymentData = {
            conversationId: currentConversation.id,
            contactId: currentConversation.contactId || null,
            contactName: currentConversation.contactName || 'Sin nombre',
            amount: amount,
            currency: 'MXN',
            description: description,
            notes: notes,
            gateway: selectedPaymentGateway,
            status: 'pending',
            trackingRef: trackingRef,
            orderId: pendingPaymentOrderId || null,
            createdAt: window.firestore.serverTimestamp(),
            createdBy: currentUser.uid,
            createdByName: userName
        };
        pendingPaymentOrderId = null; // consume

        const paymentRef = await window.firestore.addDoc(
            window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'paymentLinks'),
            paymentData
        );

        // 2. Enviar mensaje especial de liga de pago en la conversación
        const gatewayName = selectedPaymentGateway === 'stripe' ? 'Stripe' : 'MercadoPago';
        const messageText = `Liga de Pago enviada:\nMonto: $${amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN\nConcepto: ${description}\nPasarela: ${gatewayName}\nReferencia: ${trackingRef}${notes ? '\nNotas: ' + notes : ''}`;

        await window.firestore.addDoc(
            window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'conversations', currentConversation.id, 'messages'),
            {
                text: messageText,
                type: 'payment_link',
                paymentLinkId: paymentRef.id,
                paymentAmount: amount,
                paymentDescription: description,
                paymentGateway: selectedPaymentGateway,
                paymentTrackingRef: trackingRef,
                paymentStatus: 'pending',
                sender: 'agent',
                senderName: userName,
                senderUid: currentUser.uid,
                platform: currentConversation.platform,
                timestamp: window.firestore.serverTimestamp(),
                status: 'sent'
            }
        );

        // 3. Actualizar conversación
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'conversations', currentConversation.id),
            {
                lastMessage: `💳 Liga de pago: $${amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`,
                lastMessageAt: window.firestore.serverTimestamp(),
                lastMessageBy: currentUser.uid
            }
        );

        // 4. Mover funnel a "Pago Pendiente" si está en etapa anterior
        const earlyStages = ['curioso', 'cotizando'];
        if (!currentConversation.funnelStage || earlyStages.includes(currentConversation.funnelStage)) {
            await changeConvStage(currentConversation.id, 'pago_pendiente');
        }

        // 5. Si hay un pedido vinculado, cambiar su status a "pago_pendiente"
        if (paymentData.orderId) {
            try {
                await window.firestore.updateDoc(
                    window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'orders', paymentData.orderId),
                    { status: 'pago_pendiente', updatedAt: window.firestore.serverTimestamp() }
                );
                const linkedOrder = orders.find(o => o.id === paymentData.orderId);
                if (linkedOrder) linkedOrder.status = 'pago_pendiente';
                renderOrdersBadge();
            } catch (orderErr) {
                console.error('Error actualizando status del pedido:', orderErr);
            }
        }

        // Actualizar local
        const convIdx = conversations.findIndex(c => c.id === currentConversation.id);
        if (convIdx !== -1) {
            conversations[convIdx].lastMessage = `💳 Liga de pago: $${amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`;
            conversations[convIdx].lastMessageAt = new Date();
        }

        closePaymentLinkModal();
        addAppNotification('Liga de pago enviada', `Liga por $${amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN enviada a ${currentConversation.contactName}`, 'success');
    } catch (error) {
        console.error('Error enviando liga de pago:', error);
        showNotification('Error', 'No se pudo enviar la liga de pago: ' + error.message, 'error');
    }
}

async function markPaymentAsPaid(paymentLinkId, messageId) {
    if (!currentOrganization || !currentConversation) return;

    if (!confirm('¿Confirmar que el pago fue recibido? Esto moverá al cliente a "Orden Pendiente".')) return;

    try {
        // 1. Actualizar estado de la liga de pago
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'paymentLinks', paymentLinkId),
            {
                status: 'paid',
                paidAt: window.firestore.serverTimestamp(),
                confirmedBy: currentUser.uid
            }
        );

        // 2. Actualizar el mensaje de liga de pago
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'conversations', currentConversation.id, 'messages', messageId),
            {
                paymentStatus: 'paid'
            }
        );

        // 3. Mover conversación y contacto a "Orden Pendiente"
        await changeConvStage(currentConversation.id, 'orden_pendiente');

        // 4. Enviar mensaje de confirmación en la conversación
        const userName = currentUserData?.name || currentUser.displayName || currentUser.email.split('@')[0];
        await window.firestore.addDoc(
            window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'conversations', currentConversation.id, 'messages'),
            {
                text: `Pago confirmado. La orden ha sido movida a "Orden Pendiente". Referencia de pago: ${paymentLinkId.substr(0, 8)}`,
                sender: 'agent',
                senderName: 'Sistema',
                senderUid: currentUser.uid,
                platform: currentConversation.platform,
                timestamp: window.firestore.serverTimestamp(),
                status: 'sent',
                type: 'system'
            }
        );

        addAppNotification('Pago confirmado', `El pago de ${currentConversation.contactName} fue confirmado. Movido a Orden Pendiente.`, 'success');
    } catch (error) {
        console.error('Error confirmando pago:', error);
        showNotification('Error', 'No se pudo confirmar el pago: ' + error.message, 'error');
    }
}

// ========== NUEVO CHAT ==========

function openNewChatModal() {
    // Llenar selector de contactos
    const select = document.getElementById('newChatContact');
    select.innerHTML = '<option value="">Selecciona un contacto...</option>';
    contacts.forEach(contact => {
        select.innerHTML += `<option value="${contact.id}">${escapeHtml(contact.name)}${contact.phone ? ' - ' + escapeHtml(contact.phone) : ''}</option>`;
    });
    // Agregar opción para nuevo contacto
    select.innerHTML += '<option value="__new__">+ Crear nuevo contacto...</option>';

    selectedChatPlatform = null;
    document.querySelectorAll('input[name="chatPlatform"]').forEach(r => r.checked = false);
    document.querySelectorAll('.platform-option-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('newChatMessage').value = '';
    document.getElementById('newChatModal').classList.remove('hidden');
}

function closeNewChatModal() {
    document.getElementById('newChatModal').classList.add('hidden');
    selectedChatPlatform = null;
}

// ========== TEST CHAT FROM CONVERSATIONS PAGE ==========

function openTestChatFromConversations() {
    if (!aiAgents || aiAgents.length === 0) {
        showNotification('Sin agentes', 'No hay agentes de IA configurados. Ve a la sección de Agentes IA para crear uno.', 'warning');
        return;
    }

    const modal = document.getElementById('testChatAgentModal');
    const grid = document.getElementById('testChatAgentGrid');

    grid.innerHTML = aiAgents.map(agent => {
        const providerLabel = agent.provider === 'openai' ? 'OpenAI' : agent.provider === 'anthropic' ? 'Anthropic' : 'Custom';
        const channels = (agent.channels || []).map(ch => getPlatformLabel(ch)).join(', ') || 'Sin canales';
        const kbCount = (agent.knowledgeBases || []).length;
        return `
            <div class="test-chat-agent-card ${agent.active ? '' : 'test-chat-agent-inactive'}" onclick="startRealisticTestChat('${agent.id}')">
                <div class="test-chat-agent-header">
                    <span class="test-chat-agent-icon">🤖</span>
                    <span class="test-chat-agent-name">${escapeHtml(agent.name)}</span>
                    ${agent.active ? '<span class="test-chat-agent-active-badge">Activo</span>' : '<span class="test-chat-agent-inactive-badge">Inactivo</span>'}
                </div>
                <div class="test-chat-agent-meta">
                    <span>${providerLabel} · ${escapeHtml(agent.model || '--')}</span>
                </div>
                <div class="test-chat-agent-meta">
                    <span>Canales: ${escapeHtml(channels)}</span>
                </div>
                <div class="test-chat-agent-meta">
                    <span>${kbCount} base(s) de datos</span>
                </div>
            </div>
        `;
    }).join('');

    modal.classList.remove('hidden');
}

function closeTestChatAgentModal() {
    document.getElementById('testChatAgentModal').classList.add('hidden');
}

async function startRealisticTestChat(agentId) {
    const agent = aiAgents.find(a => a.id === agentId);
    if (!agent) return;

    closeTestChatAgentModal();

    // Create a test conversation in Firestore to simulate a real chat
    const userName = currentUserData?.name || currentUser.displayName || currentUser.email.split('@')[0];
    const testContactName = 'Prueba - ' + agent.name;

    try {
        const convData = {
            contactId: null,
            contactName: testContactName,
            contactPhone: '',
            contactEmail: '',
            platform: (agent.channels && agent.channels.length > 0) ? agent.channels[0] : 'manual',
            status: 'open',
            funnelStage: 'curioso',
            createdBy: currentUser.uid,
            createdAt: window.firestore.serverTimestamp(),
            lastMessage: 'Conversación de prueba iniciada',
            lastMessageAt: window.firestore.serverTimestamp(),
            lastMessageBy: currentUser.uid,
            unreadCount: 0,
            assignedTo: currentUser.uid,
            aiEnabled: true,
            isTestChat: true,
            testAgentId: agentId
        };

        const convRef = await window.firestore.addDoc(
            window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'conversations'),
            convData
        );

        // Add system message
        await window.firestore.addDoc(
            window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'conversations', convRef.id, 'messages'),
            {
                text: `Conversación de prueba con el agente "${agent.name}". Escribe como si fueras un cliente para probar las respuestas del agente. La IA está habilitada para esta conversación.`,
                sender: 'agent',
                senderName: 'Sistema',
                senderUid: currentUser.uid,
                platform: convData.platform,
                timestamp: window.firestore.serverTimestamp(),
                status: 'sent',
                type: 'system'
            }
        );

        const newConv = { id: convRef.id, ...convData, lastMessageAt: new Date(), createdAt: new Date() };
        conversations.unshift(newConv);
        renderConversationsList();
        await openConversation(convRef.id);
        addAppNotification('Chat de prueba iniciado', `Conversación de prueba con ${agent.name} creada. Escribe como cliente para probar.`, 'success');
    } catch (error) {
        console.error('Error creando chat de prueba:', error);
        showNotification('Error', 'No se pudo crear el chat de prueba: ' + error.message, 'error');
    }
}

function selectPlatform(platform) {
    selectedChatPlatform = platform;
    document.querySelectorAll('.platform-option-card').forEach(c => c.classList.remove('selected'));
    const radio = document.querySelector(`input[name="chatPlatform"][value="${platform}"]`);
    if (radio) {
        radio.checked = true;
        radio.closest('.platform-option').querySelector('.platform-option-card').classList.add('selected');
    }
}

async function startNewChat() {
    const contactSelect = document.getElementById('newChatContact');
    const contactId = contactSelect.value;
    const message = document.getElementById('newChatMessage').value.trim();

    if (!contactId) {
        showNotification('Contacto requerido', 'Selecciona un contacto para iniciar el chat.', 'warning');
        return;
    }

    if (contactId === '__new__') {
        closeNewChatModal();
        openContactModal();
        return;
    }

    if (!selectedChatPlatform) {
        showNotification('Plataforma requerida', 'Selecciona la plataforma por la que deseas enviar el mensaje.', 'warning');
        return;
    }

    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    try {
        // Verificar si ya existe conversación con ese contacto en esa plataforma
        const existingConv = conversations.find(c => c.contactId === contactId && c.platform === selectedChatPlatform);
        if (existingConv) {
            closeNewChatModal();
            await openConversation(existingConv.id);
            if (message) {
                document.getElementById('messageInput').value = message;
                await sendMessage();
            }
            return;
        }

        // Crear nueva conversación
        const userName = currentUserData?.name || currentUser.displayName || currentUser.email.split('@')[0];
        const convData = {
            contactId: contactId,
            contactName: contact.name,
            contactPhone: contact.phone || '',
            contactEmail: contact.email || '',
            platform: selectedChatPlatform,
            status: 'open',
            funnelStage: contact.funnelStage || 'curioso',
            createdBy: currentUser.uid,
            createdAt: window.firestore.serverTimestamp(),
            lastMessage: message || 'Chat iniciado',
            lastMessageAt: window.firestore.serverTimestamp(),
            lastMessageBy: currentUser.uid,
            unreadCount: 0,
            assignedTo: currentUser.uid,
            aiEnabled: true
        };

        const convRef = await window.firestore.addDoc(
            window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'conversations'),
            convData
        );

        // Si hay mensaje inicial, agregarlo
        if (message) {
            await window.firestore.addDoc(
                window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'conversations', convRef.id, 'messages'),
                {
                    text: message,
                    sender: 'agent',
                    senderName: userName,
                    senderUid: currentUser.uid,
                    platform: selectedChatPlatform,
                    timestamp: window.firestore.serverTimestamp(),
                    status: 'sent'
                }
            );
        }

        const newConv = { id: convRef.id, ...convData, lastMessageAt: new Date(), createdAt: new Date() };
        conversations.unshift(newConv);
        renderConversationsList();

        closeNewChatModal();
        await openConversation(convRef.id);
        addAppNotification('Chat iniciado', `Nuevo chat con ${contact.name} por ${getPlatformLabel(selectedChatPlatform)}`, 'success');
    } catch (error) {
        console.error('Error creando chat:', error);
        showNotification('Error', 'No se pudo crear el chat: ' + error.message, 'error');
    }
}

// ========== PERSONALIZACIÓN / BRANDING ==========

function applyBranding() {
    if (!currentOrganization) return;

    const sidebarLogo = document.querySelector('.sidebar-logo');
    const authLogo = document.querySelector('.logo');

    // Brand name
    const brandName = currentOrganization.brandName || 'MessageHub';
    if (sidebarLogo) sidebarLogo.textContent = brandName;

    // Custom logo in sidebar
    const customLogo = currentOrganization.customLogo;
    if (customLogo && sidebarLogo) {
        sidebarLogo.innerHTML = `<img src="${customLogo}" alt="${escapeHtml(brandName)}" class="sidebar-logo-img">`;
    }

    // Custom icon in sidebar header
    const orgBadgeIcon = document.querySelector('.org-badge-icon');
    const customIcon = currentOrganization.customIcon;
    if (customIcon && orgBadgeIcon) {
        orgBadgeIcon.innerHTML = `<img src="${customIcon}" alt="" class="org-badge-icon-img">`;
    }
}

async function saveBrandName() {
    if (!currentOrganization) return;
    const brandName = document.getElementById('brandNameInput').value.trim();

    try {
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id),
            { brandName: brandName || null }
        );
        currentOrganization.brandName = brandName || null;
        applyBranding();
        showNotification('Nombre guardado', brandName ? `El nombre de marca "${brandName}" fue guardado.` : 'Se restauró el nombre predeterminado.', 'success');
    } catch (error) {
        console.error('Error guardando nombre de marca:', error);
        showNotification('Error', 'No se pudo guardar el nombre de marca.', 'error');
    }
}

async function handleLogoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 200 * 1024) {
        showNotification('Archivo muy grande', 'El logo debe ser menor a 200KB.', 'warning');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64 = e.target.result;
        try {
            await window.firestore.updateDoc(
                window.firestore.doc(window.db, 'organizations', currentOrganization.id),
                { customLogo: base64 }
            );
            currentOrganization.customLogo = base64;

            document.getElementById('logoPreviewImg').src = base64;
            document.getElementById('logoPreviewImg').classList.remove('hidden');
            document.getElementById('logoPreviewPlaceholder').classList.add('hidden');
            document.getElementById('removeLogoBtn').classList.remove('hidden');

            applyBranding();
            showNotification('Logo guardado', 'El logo fue actualizado correctamente.', 'success');
        } catch (error) {
            console.error('Error subiendo logo:', error);
            showNotification('Error', 'No se pudo guardar el logo.', 'error');
        }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

async function removeLogo() {
    if (!currentOrganization) return;
    try {
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id),
            { customLogo: null }
        );
        currentOrganization.customLogo = null;
        document.getElementById('logoPreviewImg').classList.add('hidden');
        document.getElementById('logoPreviewPlaceholder').classList.remove('hidden');
        document.getElementById('removeLogoBtn').classList.add('hidden');
        applyBranding();
        showNotification('Logo eliminado', 'Se restauró el logo predeterminado.', 'success');
    } catch (error) {
        showNotification('Error', 'No se pudo eliminar el logo.', 'error');
    }
}

async function handleIconUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 100 * 1024) {
        showNotification('Archivo muy grande', 'El ícono debe ser menor a 100KB.', 'warning');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64 = e.target.result;
        try {
            await window.firestore.updateDoc(
                window.firestore.doc(window.db, 'organizations', currentOrganization.id),
                { customIcon: base64 }
            );
            currentOrganization.customIcon = base64;

            document.getElementById('iconPreviewImg').src = base64;
            document.getElementById('iconPreviewImg').classList.remove('hidden');
            document.getElementById('iconPreviewPlaceholder').classList.add('hidden');
            document.getElementById('removeIconBtn').classList.remove('hidden');

            applyBranding();
            showNotification('Ícono guardado', 'El ícono fue actualizado correctamente.', 'success');
        } catch (error) {
            console.error('Error subiendo ícono:', error);
            showNotification('Error', 'No se pudo guardar el ícono.', 'error');
        }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

async function removeIcon() {
    if (!currentOrganization) return;
    try {
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id),
            { customIcon: null }
        );
        currentOrganization.customIcon = null;
        document.getElementById('iconPreviewImg').classList.add('hidden');
        document.getElementById('iconPreviewPlaceholder').classList.remove('hidden');
        document.getElementById('removeIconBtn').classList.add('hidden');
        applyBranding();
        showNotification('Ícono eliminado', 'Se restauró el ícono predeterminado.', 'success');
    } catch (error) {
        showNotification('Error', 'No se pudo eliminar el ícono.', 'error');
    }
}

// ========== AGENTES IA ==========

const AI_MODELS = {
    openai: [
        { id: 'gpt-4o', name: 'GPT-4o (Recomendado)' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Económico)' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
    ],
    anthropic: [
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5 (Recomendado)' },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (Económico)' },
        { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' }
    ],
    custom: []
};

function onAIProviderChange() {
    const provider = document.getElementById('aiAgentProvider').value;
    const modelSelect = document.getElementById('aiAgentModel');
    const endpointGroup = document.getElementById('aiAgentEndpointGroup');

    if (provider === 'custom') {
        endpointGroup.classList.remove('hidden');
        modelSelect.innerHTML = '<option value="">Escribe el nombre del modelo</option>';
        // Convert to text input for custom
        const parent = modelSelect.parentElement;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-input';
        input.id = 'aiAgentModel';
        input.placeholder = 'nombre-del-modelo';
        parent.replaceChild(input, modelSelect);
    } else {
        endpointGroup.classList.add('hidden');
        // Ensure it's a select
        const currentEl = document.getElementById('aiAgentModel');
        if (currentEl.tagName !== 'SELECT') {
            const parent = currentEl.parentElement;
            const select = document.createElement('select');
            select.className = 'form-input form-select';
            select.id = 'aiAgentModel';
            parent.replaceChild(select, currentEl);
        }
        const sel = document.getElementById('aiAgentModel');
        const models = AI_MODELS[provider] || [];
        if (models.length === 0) {
            sel.innerHTML = '<option value="">Primero selecciona proveedor</option>';
        } else {
            sel.innerHTML = models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
        }
    }
}

async function loadAIAgents() {
    if (!currentOrganization) return;

    try {
        const agentsRef = window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'aiAgents');
        const snapshot = await window.firestore.getDocs(agentsRef);
        aiAgents = [];
        snapshot.forEach(doc => {
            aiAgents.push({ id: doc.id, ...doc.data() });
        });
        renderAIAgents();
        renderChannelMap();
    } catch (error) {
        console.error('Error cargando agentes IA:', error);
    }
}

function renderAIAgents() {
    const grid = document.getElementById('aiAgentsGrid');
    if (!grid) return;

    if (aiAgents.length === 0) {
        grid.innerHTML = `
            <div class="ai-agents-empty">
                <span class="ai-agents-empty-icon">🤖</span>
                <p>No hay agentes configurados</p>
                <p class="ai-agents-empty-hint">Crea tu primer agente de IA para automatizar la atención en tus canales de mensajería.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = aiAgents.map(agent => {
        const providerLabel = agent.provider === 'openai' ? 'OpenAI' : agent.provider === 'anthropic' ? 'Anthropic' : 'Personalizado';
        const channels = [];
        if (agent.channels) {
            if (agent.channels.whatsapp) channels.push('📱 WA');
            if (agent.channels.instagram) channels.push('📷 IG');
            if (agent.channels.messenger) channels.push('💬 MSG');
        }
        const channelsStr = channels.length > 0 ? channels.join(' · ') : 'Sin canales';
        const statusClass = agent.isActive ? 'ai-agent-active' : 'ai-agent-inactive';
        const statusLabel = agent.isActive ? 'Activo' : 'Inactivo';
        const promptPreview = (agent.systemPrompt || '').substring(0, 100) + ((agent.systemPrompt || '').length > 100 ? '...' : '');

        return `
            <div class="ai-agent-card ${statusClass}">
                <div class="ai-agent-card-header">
                    <div class="ai-agent-card-info">
                        <span class="ai-agent-card-icon">🤖</span>
                        <div>
                            <div class="ai-agent-card-name">${escapeHtml(agent.name)}</div>
                            <div class="ai-agent-card-provider">${providerLabel} · ${escapeHtml(agent.model || '')}</div>
                        </div>
                    </div>
                    <span class="ai-agent-status-badge ${statusClass}">${statusLabel}</span>
                </div>
                <div class="ai-agent-card-channels">${channelsStr}</div>
                <div class="ai-agent-card-prompt">${escapeHtml(promptPreview)}</div>
                <div class="ai-agent-card-actions">
                    <button class="btn-primary btn-sm" onclick="openAITestModal('${agent.id}')">Probar</button>
                    <button class="btn-secondary btn-sm" onclick="openAIAgentModal(aiAgents.find(a=>a.id==='${agent.id}'))">Editar</button>
                    <button class="btn-secondary btn-sm btn-integ-delete" onclick="deleteAIAgent('${agent.id}')">Eliminar</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderChannelMap() {
    const channels = ['whatsapp', 'instagram', 'messenger'];
    channels.forEach(ch => {
        const el = document.getElementById('mapAgent_' + ch);
        if (!el) return;

        const assignedAgents = aiAgents.filter(a => a.isActive && a.channels && a.channels[ch]);
        if (assignedAgents.length === 0) {
            el.textContent = 'Sin agente asignado';
            el.className = 'ai-channel-map-agent ai-channel-map-none';
        } else {
            el.textContent = assignedAgents.map(a => a.name).join(', ');
            el.className = 'ai-channel-map-agent ai-channel-map-assigned';
        }
    });
}

function openAIAgentModal(agent = null) {
    const title = document.getElementById('aiAgentModalTitle');
    const editId = document.getElementById('aiAgentEditId');

    // Populate knowledge base checkboxes
    populateKBCheckboxes(agent ? (agent.knowledgeBases || []) : []);

    if (agent) {
        title.textContent = 'Editar Agente IA';
        editId.value = agent.id;
        document.getElementById('aiAgentName').value = agent.name || '';
        document.getElementById('aiAgentProvider').value = agent.provider || '';
        onAIProviderChange();
        setTimeout(() => {
            const modelEl = document.getElementById('aiAgentModel');
            if (modelEl) modelEl.value = agent.model || '';
        }, 50);
        document.getElementById('aiAgentApiKey').value = agent.apiKey || '';
        document.getElementById('aiAgentEndpoint').value = agent.endpoint || '';
        document.getElementById('aiAgentSystemPrompt').value = agent.systemPrompt || '';
        document.getElementById('aiAgentActive').checked = agent.isActive !== false;

        document.getElementById('aiCh_whatsapp').checked = agent.channels?.whatsapp || false;
        document.getElementById('aiCh_instagram').checked = agent.channels?.instagram || false;
        document.getElementById('aiCh_messenger').checked = agent.channels?.messenger || false;
    } else {
        title.textContent = 'Crear Agente IA';
        editId.value = '';
        document.getElementById('aiAgentName').value = '';
        document.getElementById('aiAgentProvider').value = '';
        document.getElementById('aiAgentApiKey').value = '';
        document.getElementById('aiAgentEndpoint').value = '';
        document.getElementById('aiAgentSystemPrompt').value = '';
        document.getElementById('aiAgentActive').checked = true;
        document.getElementById('aiCh_whatsapp').checked = false;
        document.getElementById('aiCh_instagram').checked = false;
        document.getElementById('aiCh_messenger').checked = false;

        const modelEl = document.getElementById('aiAgentModel');
        if (modelEl.tagName === 'SELECT') {
            modelEl.innerHTML = '<option value="">Primero selecciona proveedor</option>';
        } else {
            modelEl.value = '';
        }
        document.getElementById('aiAgentEndpointGroup').classList.add('hidden');
    }

    document.getElementById('aiAgentModal').classList.remove('hidden');
}

function populateKBCheckboxes(selectedIds) {
    const container = document.getElementById('aiKbCheckboxes');
    if (!container) return;
    if (knowledgeBases.length === 0) {
        container.innerHTML = '<span class="integ-field-hint">No hay bases de datos. Sube un Excel desde la página de Agentes IA.</span>';
        return;
    }
    container.innerHTML = knowledgeBases.map(kb => {
        const checked = selectedIds.includes(kb.id) ? 'checked' : '';
        return `
            <label class="ai-channel-check">
                <input type="checkbox" value="${kb.id}" ${checked}>
                <span class="ai-channel-label">📊 ${escapeHtml(kb.name)} (${kb.rowCount || 0} filas)</span>
            </label>
        `;
    }).join('');
}

function closeAIAgentModal() {
    document.getElementById('aiAgentModal').classList.add('hidden');
}

async function saveAIAgent() {
    if (!currentOrganization) return;

    const name = document.getElementById('aiAgentName').value.trim();
    const provider = document.getElementById('aiAgentProvider').value;
    const model = document.getElementById('aiAgentModel').value.trim ? document.getElementById('aiAgentModel').value.trim() : document.getElementById('aiAgentModel').value;
    const apiKey = document.getElementById('aiAgentApiKey').value.trim();
    const endpoint = document.getElementById('aiAgentEndpoint').value.trim();
    const systemPrompt = document.getElementById('aiAgentSystemPrompt').value.trim();
    const isActive = document.getElementById('aiAgentActive').checked;

    if (!name) {
        showNotification('Campo requerido', 'Ingresa un nombre para el agente.', 'warning');
        return;
    }
    if (!provider) {
        showNotification('Campo requerido', 'Selecciona un proveedor de IA.', 'warning');
        return;
    }
    if (!model) {
        showNotification('Campo requerido', 'Selecciona o escribe un modelo.', 'warning');
        return;
    }
    if (!apiKey) {
        showNotification('Campo requerido', 'Ingresa la API Key.', 'warning');
        return;
    }
    if (provider === 'custom' && !endpoint) {
        showNotification('Campo requerido', 'Ingresa la URL del endpoint para el proveedor personalizado.', 'warning');
        return;
    }
    if (!systemPrompt) {
        showNotification('Campo requerido', 'Define el system prompt del agente.', 'warning');
        return;
    }

    const channels = {
        whatsapp: document.getElementById('aiCh_whatsapp').checked,
        instagram: document.getElementById('aiCh_instagram').checked,
        messenger: document.getElementById('aiCh_messenger').checked
    };

    // Collect selected knowledge bases
    const selectedKBs = [];
    document.querySelectorAll('#aiKbCheckboxes input[type="checkbox"]:checked').forEach(cb => {
        selectedKBs.push(cb.value);
    });

    const agentData = {
        name,
        provider,
        model,
        apiKey,
        endpoint: provider === 'custom' ? endpoint : '',
        systemPrompt,
        isActive,
        channels,
        knowledgeBases: selectedKBs,
        updatedAt: window.firestore.serverTimestamp()
    };

    const editId = document.getElementById('aiAgentEditId').value;

    try {
        if (editId) {
            await window.firestore.updateDoc(
                window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'aiAgents', editId),
                agentData
            );
            const idx = aiAgents.findIndex(a => a.id === editId);
            if (idx !== -1) aiAgents[idx] = { ...aiAgents[idx], ...agentData };
            showNotification('Agente actualizado', `El agente "${name}" fue actualizado.`, 'success');
        } else {
            agentData.createdAt = window.firestore.serverTimestamp();
            agentData.createdBy = currentUser.uid;
            const docRef = await window.firestore.addDoc(
                window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'aiAgents'),
                agentData
            );
            aiAgents.push({ id: docRef.id, ...agentData });
            showNotification('Agente creado', `El agente "${name}" fue creado exitosamente.`, 'success');
        }

        renderAIAgents();
        renderChannelMap();
        closeAIAgentModal();
    } catch (error) {
        console.error('Error guardando agente IA:', error);
        showNotification('Error', 'No se pudo guardar el agente: ' + error.message, 'error');
    }
}

async function deleteAIAgent(agentId) {
    const agent = aiAgents.find(a => a.id === agentId);
    if (!agent) return;
    if (!confirm(`¿Eliminar el agente "${agent.name}"? Esta acción no se puede deshacer.`)) return;

    try {
        await window.firestore.deleteDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'aiAgents', agentId)
        );
        aiAgents = aiAgents.filter(a => a.id !== agentId);
        renderAIAgents();
        renderChannelMap();
        showNotification('Agente eliminado', `El agente "${agent.name}" fue eliminado.`, 'success');
    } catch (error) {
        console.error('Error eliminando agente IA:', error);
        showNotification('Error', 'No se pudo eliminar el agente.', 'error');
    }
}

// Toggle IA por conversación
async function toggleConvAI(convId, enabled) {
    if (!currentOrganization) return;

    try {
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'conversations', convId),
            { aiEnabled: enabled }
        );

        const conv = conversations.find(c => c.id === convId);
        if (conv) conv.aiEnabled = enabled;

        addAppNotification(
            enabled ? 'IA activada' : 'IA desactivada',
            `La IA fue ${enabled ? 'activada' : 'desactivada'} para esta conversación.`,
            'success'
        );
    } catch (error) {
        console.error('Error toggling AI:', error);
        showNotification('Error', 'No se pudo cambiar el estado de la IA.', 'error');
    }
}

// ========== PROBAR AGENTE IA (TEST CHAT) ==========

let aiTestConversation = [];
let aiTestAgent = null;
let aiTestLoading = false;

function openAITestModal(agentId) {
    const agent = aiAgents.find(a => a.id === agentId);
    if (!agent) return;

    aiTestAgent = agent;
    aiTestConversation = [];
    aiTestLoading = false;

    document.getElementById('aiTestAgentId').value = agentId;
    document.getElementById('aiTestAgentName').textContent = agent.name;

    // Info bar
    const providerLabel = agent.provider === 'openai' ? 'OpenAI' : agent.provider === 'anthropic' ? 'Anthropic' : 'Custom';
    const kbCount = (agent.knowledgeBases || []).length;
    document.getElementById('aiTestInfo').textContent = `${providerLabel} · ${agent.model} · ${kbCount} base(s) de datos`;

    // Build enriched prompt with data for preview
    document.getElementById('aiTestPromptText').textContent = 'Cargando datos de las bases de conocimiento...';
    document.getElementById('aiTestPromptPreview').classList.add('hidden');

    // Reset chat
    document.getElementById('aiTestMessages').innerHTML = `
        <div class="ai-test-welcome">
            <span class="ai-test-welcome-icon">🤖</span>
            <p>Envía un mensaje para probar cómo responde <strong>${escapeHtml(agent.name)}</strong>.</p>
            <p class="ai-test-welcome-hint">El agente usará su system prompt y los datos reales de las bases de datos asignadas.</p>
        </div>
    `;

    document.getElementById('aiTestInput').value = '';
    document.getElementById('aiTestModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('aiTestInput').focus(), 100);

    // Pre-load the full prompt with data (async)
    buildAISystemPromptWithData(agent).then(fullPrompt => {
        document.getElementById('aiTestPromptText').textContent = fullPrompt;
    });
}

function closeAITestModal() {
    document.getElementById('aiTestModal').classList.add('hidden');
    aiTestAgent = null;
    aiTestConversation = [];
}

function toggleTestPromptPreview() {
    document.getElementById('aiTestPromptPreview').classList.toggle('hidden');
}

function appendTestMessage(role, text) {
    const container = document.getElementById('aiTestMessages');
    // Remove welcome if first message
    const welcome = container.querySelector('.ai-test-welcome');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = `ai-test-msg ai-test-msg-${role}`;
    div.innerHTML = `
        <div class="ai-test-msg-bubble">
            <div class="ai-test-msg-sender">${role === 'user' ? 'Tú' : '🤖 ' + escapeHtml(aiTestAgent?.name || 'Agente')}</div>
            <div class="ai-test-msg-text">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendTestLoading() {
    const container = document.getElementById('aiTestMessages');
    const div = document.createElement('div');
    div.className = 'ai-test-msg ai-test-msg-assistant';
    div.id = 'aiTestLoading';
    div.innerHTML = `
        <div class="ai-test-msg-bubble ai-test-loading">
            <span class="spinner"></span> Pensando...
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function removeTestLoading() {
    const el = document.getElementById('aiTestLoading');
    if (el) el.remove();
}

async function sendTestMessage() {
    if (aiTestLoading || !aiTestAgent) return;
    const input = document.getElementById('aiTestInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    appendTestMessage('user', text);
    aiTestConversation.push({ role: 'user', content: text });

    aiTestLoading = true;
    document.getElementById('aiTestSendBtn').disabled = true;
    appendTestLoading();

    try {
        // Update loading text to show data is being loaded
        const loadingEl = document.querySelector('#aiTestLoading .ai-test-loading');
        if (loadingEl) loadingEl.innerHTML = '<span class="spinner"></span> Cargando datos y consultando IA...';

        const response = await callAIProvider(aiTestAgent, aiTestConversation);
        removeTestLoading();
        appendTestMessage('assistant', response);
        aiTestConversation.push({ role: 'assistant', content: response });
    } catch (error) {
        removeTestLoading();
        let errMsg = error.message || 'No se pudo obtener respuesta';
        // Provide helpful error messages
        if (errMsg.includes('401') || errMsg.includes('Unauthorized') || errMsg.includes('invalid_api_key')) {
            errMsg = 'API Key inválida o expirada. Verifica la clave en la configuración del agente.';
        } else if (errMsg.includes('429')) {
            errMsg = 'Demasiadas solicitudes. Espera unos segundos e intenta de nuevo.';
        } else if (errMsg.includes('insufficient_quota') || errMsg.includes('billing')) {
            errMsg = 'Sin crédito disponible en la cuenta del proveedor de IA. Recarga tu saldo.';
        } else if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
            if (aiTestAgent?.provider === 'custom') {
                errMsg = 'Error de conexión con el endpoint personalizado. Verifica que la URL sea correcta y que el servidor tenga CORS habilitado para este dominio (Access-Control-Allow-Origin).';
            } else {
                errMsg = 'Error de conexión. Verifica tu internet o que la API Key sea correcta.';
            }
        }
        appendTestMessage('assistant', `Error: ${errMsg}`);
    } finally {
        aiTestLoading = false;
        document.getElementById('aiTestSendBtn').disabled = false;
        input.focus();
    }
}

// ── Limpieza de respuestas del modelo (quita XML, narración interna) ────────
function cleanAIResponse(text) {
    if (!text) return text;
    let cleaned = text;

    // Bloques XML de function-calls
    cleaned = cleaned.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '');
    cleaned = cleaned.replace(/<invoke[\s\S]*?<\/invoke>/gi, '');
    cleaned = cleaned.replace(/<invoke[\s\S]*?<\/antml:invoke>/gi, '');
    cleaned = cleaned.replace(/<parameter[\s\S]*?<\/parameter>/gi, '');
    cleaned = cleaned.replace(/<\/?(function_calls|invoke|parameter|antml:invoke)[^>]*>/gi, '');

    // Bloques markdown de código con tool calls
    cleaned = cleaned.replace(/```[a-z]*\n?[\s\S]*?```/g, (match) => {
        if (/invoke|function_call|query_database|save_contact|create_order|<parameter/i.test(match)) return '';
        return match;
    });

    // Narrativa de consultas internas
    const narrativePatterns = [
        /[Dd]éjame\s+(consultar|verificar|revisar|buscar|checar)\w*\s*[^.!?\n]*[.…]{0,3}\s*/g,
        /[Vv]oy\s+a\s+(consultar|verificar|revisar|buscar|checar)\w*\s*[^.!?\n]*[.…]{0,3}\s*/g,
        /[Pp]ermíteme\s+(consultar|verificar|revisar|buscar|checar)\w*\s*[^.!?\n]*[.…]{0,3}\s*/g,
        /[Cc]onsultando\s+(en\s+)?(el\s+)?(sistema|inventario|base\s+de\s+datos)[^.!?\n]*[.…]{0,3}\s*/g,
        /[Bb]uscando\s+(en\s+)?(el\s+)?(sistema|inventario|base\s+de\s+datos|catálogo)[^.!?\n]*[.…*]{0,5}\s*/g,
        /[Ll]isto,?\s*déjame\s+revisar\s+[^.!?\n]*[.…]{0,3}\s*/g,
        /[Uu]n\s+momento\s+(mientras|que)\s+(consulto|verifico|reviso|busco)[^.!?\n]*[.…]{0,3}\s*/g,
        /🔍[^.!?\n]*[.…*]{0,5}\s*/g,
    ];
    for (const pattern of narrativePatterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
}

// ── Parseo de tool calls XML incrustados en texto ───────────────────────────
function parseTextToolCallsFromResponse(text) {
    if (!text) return [];
    const calls = [];
    const invokeRegex = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/gi;
    let match;
    while ((match = invokeRegex.exec(text)) !== null) {
        const name = match[1];
        const body = match[2];
        const params = {};
        const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/gi;
        let pm;
        while ((pm = paramRegex.exec(body)) !== null) {
            let val = pm[2].trim();
            if (/^\d+(\.\d+)?$/.test(val)) val = Number(val);
            params[pm[1]] = val;
        }
        calls.push({ name, params });
    }
    return calls;
}

// ── Ejecutar tool calls recuperados del texto (browser-side) ────────────────
async function executeRecoveredToolCalls(calls, agent) {
    const results = [];
    for (const call of calls) {
        let content;
        try {
            if (call.name === 'query_database') {
                const kbId = call.params.knowledgeBaseId
                    || (agent.knowledgeBases?.length ? agent.knowledgeBases[0] : null);
                if (kbId) {
                    content = await queryKnowledgeBase(
                        kbId,
                        call.params.searchQuery || '',
                        call.params,
                        call.params.limit || 25
                    );
                } else {
                    content = 'No hay base de datos configurada.';
                }
            } else if (call.name === 'save_contact') {
                const r = await saveContactFromAI(call.params);
                content = r.success
                    ? `Contacto ${r.action}: ${r.name}`
                    : `Error: ${r.message}`;
            } else if (call.name === 'create_order') {
                const r = await createOrderFromAI(call.params);
                content = r.success
                    ? `Pedido ${r.orderNumber}. Total: $${(r.total || 0).toFixed(2)}`
                    : `Error: ${r.message}`;
            } else {
                continue;
            }
        } catch (err) {
            console.error(`Error ejecutando ${call.name} recuperado:`, err);
            content = `Error al ejecutar ${call.name}.`;
        }
        results.push({ name: call.name, content });
    }
    return results.length > 0 ? results : null;
}

// Call AI provider API (OpenAI / Anthropic / Custom)
async function callAIProvider(agent, messages) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userMessage = lastUserMsg?.content || '';
    const systemPrompt = await buildAISystemPromptWithData(agent, userMessage);
    const tools = buildAIToolDefinitions(agent);

    if (agent.provider === 'anthropic') {
        return await callAnthropic(agent, systemPrompt, messages, tools);
    } else {
        return await callOpenAI(agent, systemPrompt, messages, tools);
    }
}

async function callOpenAI(agent, systemPrompt, messages, tools) {
    const endpoint = agent.provider === 'custom' && agent.endpoint
        ? agent.endpoint
        : 'https://api.openai.com/v1/chat/completions';

    const history = [
        { role: 'system', content: systemPrompt },
        ...messages
    ];

    const MAX_ROUNDS = 5;

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const body = {
            model: agent.model,
            messages: history,
            max_tokens: 2048,
            temperature: 0.7
        };
        if (tools.length > 0) body.tools = tools;

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${agent.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Error ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        const choice = data.choices?.[0];

        // ── Ruta nativa: tool calls via API ─────────────────────────────
        if (choice?.finish_reason === 'tool_calls' || choice?.message?.tool_calls?.length) {
            const toolCalls = choice.message.tool_calls;
            const toolResults = [];

            for (const tc of toolCalls) {
                const args = JSON.parse(tc.function.arguments);
                let content;

                if (tc.function.name === 'query_database') {
                    const kbId = args.knowledgeBaseId
                        || (agent.knowledgeBases?.length ? agent.knowledgeBases[0] : null);
                    content = kbId
                        ? await queryKnowledgeBase(kbId, args.searchQuery || '', args, args.limit || 25)
                        : 'No hay base de datos configurada.';
                } else if (tc.function.name === 'save_contact') {
                    const r = await saveContactFromAI(args);
                    content = r.success
                        ? `Contacto ${r.action === 'created' ? 'creado' : 'actualizado'}: ${r.name}`
                        : `Error: ${r.message}`;
                } else if (tc.function.name === 'create_order') {
                    const r = await createOrderFromAI(args);
                    content = r.success
                        ? `Pedido creado. Número: ${r.orderNumber}. Total: $${(r.total || 0).toFixed(2)}.`
                        : `Error: ${r.message}`;
                } else {
                    content = 'Herramienta no reconocida.';
                }

                toolResults.push({ role: 'tool', tool_call_id: tc.id, content });
            }

            history.push(choice.message);
            history.push(...toolResults);
            continue;
        }

        // ── Respuesta final (texto) ─────────────────────────────────────
        const rawText = choice?.message?.content || '';

        // ── Recuperación: tool calls XML en texto ───────────────────────
        if (round < MAX_ROUNDS - 1) {
            const textCalls = parseTextToolCallsFromResponse(rawText);
            if (textCalls.length > 0) {
                const recovered = await executeRecoveredToolCalls(textCalls, agent);
                if (recovered) {
                    const resultsText = recovered
                        .map(r => `[Resultado de ${r.name}]:\n${r.content}`)
                        .join('\n\n');

                    history.push({
                        role: 'assistant',
                        content: cleanAIResponse(rawText) || 'Consulté el inventario.',
                    });
                    history.push({
                        role: 'user',
                        content: '[SISTEMA] Los resultados de la consulta al inventario son:\n\n'
                            + resultsText + '\n\n'
                            + 'Responde al cliente directamente con esta información. '
                            + 'Presenta producto, precio, disponibilidad y tiempo de entrega. '
                            + 'NO narres que hiciste una consulta. NO incluyas XML ni etiquetas. '
                            + 'IMPORTANTE: Después de presentar la cotización, DEBES pedir los datos del cliente (nombre, celular, empresa, email, dirección, RFC) y llamar save_contact, y luego crear el pedido con create_order. Ambos son OBLIGATORIOS.',
                    });
                    continue;
                }
            }
        }

        return cleanAIResponse(rawText) || 'Sin respuesta del modelo.';
    }

    return 'Sin respuesta del modelo.';
}

async function callAnthropic(agent, systemPrompt, messages, tools) {
    const anthropicHistory = messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
    }));

    const anthropicTools = tools.length > 0
        ? tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters
        }))
        : [];

    const MAX_ROUNDS = 5;

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const body = {
            model: agent.model,
            max_tokens: 2048,
            system: systemPrompt,
            messages: anthropicHistory,
            ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
        };

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': agent.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Error ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');

        // ── Ruta nativa: tool_use via API ───────────────────────────────
        if (toolUseBlocks.length > 0) {
            const toolResultContents = [];

            for (const tb of toolUseBlocks) {
                let content;

                if (tb.name === 'query_database') {
                    const kbId = tb.input.knowledgeBaseId
                        || (agent.knowledgeBases?.length ? agent.knowledgeBases[0] : null);
                    content = kbId
                        ? await queryKnowledgeBase(kbId, tb.input.searchQuery || '', tb.input, tb.input.limit || 25)
                        : 'No hay base de datos configurada.';
                } else if (tb.name === 'save_contact') {
                    const r = await saveContactFromAI(tb.input);
                    content = r.success
                        ? `Contacto ${r.action === 'created' ? 'creado' : 'actualizado'}: ${r.name}`
                        : `Error: ${r.message}`;
                } else if (tb.name === 'create_order') {
                    const r = await createOrderFromAI(tb.input);
                    content = r.success
                        ? `Pedido creado. Número: ${r.orderNumber}. Total: $${(r.total || 0).toFixed(2)}.`
                        : `Error: ${r.message}`;
                } else {
                    content = 'Herramienta no reconocida.';
                }

                toolResultContents.push({ type: 'tool_result', tool_use_id: tb.id, content });
            }

            anthropicHistory.push({ role: 'assistant', content: data.content });
            anthropicHistory.push({ role: 'user', content: toolResultContents });
            continue;
        }

        // ── Respuesta final (texto) ─────────────────────────────────────
        const textBlock = (data.content || []).find(b => b.type === 'text');
        const rawText = textBlock?.text || '';

        // ── Recuperación: tool calls XML en texto ───────────────────────
        if (round < MAX_ROUNDS - 1) {
            const textCalls = parseTextToolCallsFromResponse(rawText);
            if (textCalls.length > 0) {
                const recovered = await executeRecoveredToolCalls(textCalls, agent);
                if (recovered) {
                    const resultsText = recovered
                        .map(r => `[Resultado de ${r.name}]:\n${r.content}`)
                        .join('\n\n');

                    anthropicHistory.push({
                        role: 'assistant',
                        content: cleanAIResponse(rawText) || 'Consulté el inventario.',
                    });
                    anthropicHistory.push({
                        role: 'user',
                        content: '[SISTEMA] Los resultados de la consulta al inventario son:\n\n'
                            + resultsText + '\n\n'
                            + 'Responde al cliente directamente con esta información. '
                            + 'Presenta producto, precio, disponibilidad y tiempo de entrega. '
                            + 'NO narres que hiciste una consulta. NO incluyas XML ni etiquetas. '
                            + 'IMPORTANTE: Después de presentar la cotización, DEBES pedir los datos del cliente (nombre, celular, empresa, email, dirección, RFC) y llamar save_contact, y luego crear el pedido con create_order. Ambos son OBLIGATORIOS.',
                    });
                    continue;
                }
            }
        }

        return cleanAIResponse(rawText) || 'Sin respuesta del modelo.';
    }

    return 'Sin respuesta del modelo.';
}

// ========== BASES DE DATOS / KNOWLEDGE BASES ==========

async function loadKnowledgeBases() {
    if (!currentOrganization) return;
    try {
        const kbRef = window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'knowledgeBases');
        const snapshot = await window.firestore.getDocs(kbRef);
        knowledgeBases = [];
        snapshot.forEach(doc => {
            knowledgeBases.push({ id: doc.id, ...doc.data() });
        });
        renderKnowledgeBases();
    } catch (error) {
        console.error('Error cargando bases de datos:', error);
    }
}

function renderKnowledgeBases() {
    const grid = document.getElementById('kbGrid');
    if (!grid) return;

    if (knowledgeBases.length === 0) {
        grid.innerHTML = `
            <div class="kb-empty">
                <span class="kb-empty-icon">📊</span>
                <p>No hay bases de datos cargadas</p>
                <p class="kb-empty-hint">Sube un archivo Excel para crear tu primera base de conocimiento.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = knowledgeBases.map(kb => {
        const date = kb.createdAt ? (kb.createdAt.toDate ? kb.createdAt.toDate() : new Date(kb.createdAt)) : null;
        const dateStr = date ? date.toLocaleDateString('es-MX') : '--';
        const columnsStr = (kb.columns || []).join(', ');
        const agentsUsing = aiAgents.filter(a => a.knowledgeBases && a.knowledgeBases.includes(kb.id));
        const agentNames = agentsUsing.length > 0 ? agentsUsing.map(a => a.name).join(', ') : 'Ningún agente';

        return `
            <div class="kb-card">
                <div class="kb-card-header">
                    <div class="kb-card-info">
                        <span class="kb-card-icon">📊</span>
                        <div>
                            <div class="kb-card-name">${escapeHtml(kb.name)}</div>
                            <div class="kb-card-desc">${escapeHtml(kb.description || '')}</div>
                        </div>
                    </div>
                </div>
                <div class="kb-card-meta">
                    <span><strong>${kb.rowCount || 0}</strong> filas</span>
                    <span><strong>${(kb.columns || []).length}</strong> columnas</span>
                    <span>${escapeHtml(kb.sourceFileName || '')}</span>
                </div>
                <div class="kb-card-columns">
                    <span class="kb-card-columns-label">Columnas:</span>
                    ${(kb.columns || []).map(c => `<span class="kb-column-tag">${escapeHtml(c)}</span>`).join('')}
                </div>
                <div class="kb-card-agents">
                    <span class="kb-card-agents-label">Usado por:</span>
                    <span class="kb-card-agents-value">${escapeHtml(agentNames)}</span>
                </div>
                <div class="kb-card-footer">
                    <span class="kb-card-date">Creado: ${dateStr}</span>
                    <div class="kb-card-actions">
                        <button class="btn-secondary btn-sm" onclick="openExcelUploadModal('${kb.id}')">Actualizar</button>
                        <button class="btn-secondary btn-sm btn-integ-delete" onclick="deleteKnowledgeBase('${kb.id}')">Eliminar</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function deleteKnowledgeBase(kbId) {
    const kb = knowledgeBases.find(k => k.id === kbId);
    if (!kb) return;
    if (!confirm(`¿Eliminar la base de datos "${kb.name}"? Se borrarán todos los datos importados.`)) return;

    try {
        // Delete all rows in the knowledge base
        const rowsRef = window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'knowledgeBases', kbId, 'rows');
        const rowsSnap = await window.firestore.getDocs(rowsRef);
        const deletePromises = [];
        rowsSnap.forEach(docSnap => {
            deletePromises.push(
                window.firestore.deleteDoc(
                    window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'knowledgeBases', kbId, 'rows', docSnap.id)
                )
            );
        });
        await Promise.all(deletePromises);

        // Delete the knowledge base document
        await window.firestore.deleteDoc(
            window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'knowledgeBases', kbId)
        );

        knowledgeBases = knowledgeBases.filter(k => k.id !== kbId);
        renderKnowledgeBases();
        showNotification('Base eliminada', `La base de datos "${kb.name}" fue eliminada.`, 'success');
    } catch (error) {
        console.error('Error eliminando base de datos:', error);
        showNotification('Error', 'No se pudo eliminar la base de datos.', 'error');
    }
}

// ========== EXCEL UPLOAD / IMPORT ==========

function openExcelUploadModal(kbId = null) {
    const title = document.getElementById('excelUploadTitle');
    document.getElementById('kbEditId').value = kbId || '';

    if (kbId) {
        const kb = knowledgeBases.find(k => k.id === kbId);
        title.textContent = 'Actualizar Base de Datos';
        document.getElementById('kbName').value = kb ? kb.name : '';
        document.getElementById('kbDescription').value = kb ? (kb.description || '') : '';
    } else {
        title.textContent = 'Subir Base de Datos desde Excel';
        document.getElementById('kbName').value = '';
        document.getElementById('kbDescription').value = '';
    }

    clearExcelFile();
    document.getElementById('excelUploadModal').classList.remove('hidden');
}

function closeExcelUploadModal() {
    document.getElementById('excelUploadModal').classList.add('hidden');
    parsedExcelData = null;
    parsedExcelWorkbook = null;
}

function handleExcelDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('dragover');
    const file = event.dataTransfer.files[0];
    if (file) processExcelFile(file);
}

function handleExcelFileSelect(event) {
    const file = event.target.files[0];
    if (file) processExcelFile(file);
}

function processExcelFile(file) {
    if (file.size > 5 * 1024 * 1024) {
        showNotification('Archivo muy grande', 'El archivo debe ser menor a 5MB.', 'warning');
        return;
    }

    const validExts = ['.xlsx', '.xls', '.csv'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!validExts.includes(ext)) {
        showNotification('Formato no soportado', 'Solo se aceptan archivos .xlsx, .xls o .csv', 'warning');
        return;
    }

    document.getElementById('excelFileName').textContent = file.name;
    document.getElementById('excelUploadZone').classList.add('hidden');
    document.getElementById('excelFileInfo').classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            parsedExcelWorkbook = workbook;

            // Show sheet selector if multiple sheets
            const sheetSelector = document.getElementById('sheetSelector');
            const sheetGroup = document.getElementById('sheetSelectorGroup');
            if (workbook.SheetNames.length > 1) {
                sheetSelector.innerHTML = workbook.SheetNames.map((name, i) =>
                    `<option value="${i}">${escapeHtml(name)}</option>`
                ).join('');
                sheetGroup.classList.remove('hidden');
            } else {
                sheetGroup.classList.add('hidden');
            }

            selectExcelSheet(0);
        } catch (err) {
            console.error('Error parsing Excel:', err);
            showNotification('Error al leer archivo', 'No se pudo leer el archivo Excel. Verifica que no esté corrupto.', 'error');
            clearExcelFile();
        }
    };
    reader.readAsArrayBuffer(file);
}

function selectExcelSheet(sheetIndex) {
    if (!parsedExcelWorkbook) return;

    const sheetName = parsedExcelWorkbook.SheetNames[sheetIndex];
    const worksheet = parsedExcelWorkbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    if (jsonData.length < 2) {
        showNotification('Sin datos', 'La hoja seleccionada no tiene datos suficientes (necesita al menos encabezados + 1 fila).', 'warning');
        parsedExcelData = null;
        document.getElementById('excelPreviewWrapper').classList.add('hidden');
        document.getElementById('importExcelBtn').disabled = true;
        return;
    }

    // First row is headers
    const headers = jsonData[0].map((h, i) => {
        const name = String(h || '').trim();
        return name || `Columna_${i + 1}`;
    });
    const rows = jsonData.slice(1).filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined));

    parsedExcelData = { headers, rows, sheetName };

    document.getElementById('excelFileMeta').textContent = `${rows.length} filas, ${headers.length} columnas — Hoja: ${sheetName}`;
    document.getElementById('excelPreviewCount').textContent = `${rows.length} filas totales`;

    // Render preview table (max 20 rows)
    const previewRows = rows.slice(0, 20);
    const thead = document.getElementById('excelPreviewHead');
    const tbody = document.getElementById('excelPreviewBody');

    thead.innerHTML = `<tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
    tbody.innerHTML = previewRows.map(row =>
        `<tr>${headers.map((_, i) => {
            let val = row[i];
            if (val instanceof Date) val = val.toLocaleDateString('es-MX');
            return `<td>${escapeHtml(String(val ?? ''))}</td>`;
        }).join('')}</tr>`
    ).join('');

    const footer = document.getElementById('excelPreviewFooter');
    if (rows.length > 20) {
        footer.textContent = `Mostrando 20 de ${rows.length} filas. Todas las filas se importarán.`;
    } else {
        footer.textContent = '';
    }

    document.getElementById('excelPreviewWrapper').classList.remove('hidden');
    document.getElementById('importExcelBtn').disabled = false;

    // Auto-fill name from filename if empty
    const nameInput = document.getElementById('kbName');
    if (!nameInput.value) {
        const fileName = document.getElementById('excelFileName').textContent;
        nameInput.value = fileName.replace(/\.(xlsx|xls|csv)$/i, '');
    }
}

function clearExcelFile() {
    parsedExcelData = null;
    parsedExcelWorkbook = null;
    document.getElementById('excelUploadZone').classList.remove('hidden');
    document.getElementById('excelFileInfo').classList.add('hidden');
    document.getElementById('sheetSelectorGroup').classList.add('hidden');
    document.getElementById('excelPreviewWrapper').classList.add('hidden');
    document.getElementById('importExcelBtn').disabled = true;
    document.getElementById('excelFileInput').value = '';
}

async function importExcelToFirestore() {
    if (!currentOrganization || !parsedExcelData) return;

    const name = document.getElementById('kbName').value.trim();
    const description = document.getElementById('kbDescription').value.trim();
    const kbEditId = document.getElementById('kbEditId').value;

    if (!name) {
        showNotification('Nombre requerido', 'Ingresa un nombre para la base de datos.', 'warning');
        return;
    }

    const { headers, rows } = parsedExcelData;
    const fileName = document.getElementById('excelFileName').textContent;

    const btn = document.getElementById('importExcelBtn');
    btn.disabled = true;
    btn.textContent = 'Importando...';

    try {
        let kbId = kbEditId;

        // If updating, delete existing rows first
        if (kbEditId) {
            const existingRowsRef = window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'knowledgeBases', kbEditId, 'rows');
            const existingSnap = await window.firestore.getDocs(existingRowsRef);
            const delPromises = [];
            existingSnap.forEach(docSnap => {
                delPromises.push(
                    window.firestore.deleteDoc(
                        window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'knowledgeBases', kbEditId, 'rows', docSnap.id)
                    )
                );
            });
            await Promise.all(delPromises);
        }

        // Create or update knowledge base document
        const kbData = {
            name,
            description,
            columns: headers,
            rowCount: rows.length,
            sourceFileName: fileName,
            updatedAt: window.firestore.serverTimestamp()
        };

        if (kbEditId) {
            await window.firestore.updateDoc(
                window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'knowledgeBases', kbEditId),
                kbData
            );
        } else {
            kbData.createdAt = window.firestore.serverTimestamp();
            kbData.createdBy = currentUser.uid;
            const kbRef = await window.firestore.addDoc(
                window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'knowledgeBases'),
                kbData
            );
            kbId = kbRef.id;
        }

        // Import rows in batches of 20
        const batchSize = 20;
        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const promises = batch.map(row => {
                const rowObj = {};
                headers.forEach((h, idx) => {
                    let val = row[idx];
                    if (val instanceof Date) val = val.toISOString();
                    rowObj[h] = val ?? '';
                });
                return window.firestore.addDoc(
                    window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'knowledgeBases', kbId, 'rows'),
                    rowObj
                );
            });
            await Promise.all(promises);

            // Update button progress
            const pct = Math.min(100, Math.round(((i + batchSize) / rows.length) * 100));
            btn.textContent = `Importando... ${pct}%`;
        }

        // Update local state
        await loadKnowledgeBases();
        closeExcelUploadModal();
        showNotification('Importación exitosa', `Se importaron ${rows.length} filas a "${name}".`, 'success');
    } catch (error) {
        console.error('Error importando Excel:', error);
        showNotification('Error', 'No se pudo importar los datos: ' + error.message, 'error');
    } finally {
        btn.textContent = 'Importar a Base de Datos';
        btn.disabled = false;
    }
}

// ========== GENERACIÓN DE CONTEXTO IA CON BASE DE DATOS ==========

// Genera el system prompt enriquecido con esquema de bases de datos
function buildAISystemPrompt(agent) {
    // Versión sincrónica (sin datos, solo esquema) - para referencia rápida
    let prompt = agent.systemPrompt || '';
    const agentKBs = (agent.knowledgeBases || [])
        .map(kbId => knowledgeBases.find(kb => kb.id === kbId))
        .filter(Boolean);
    if (agentKBs.length === 0) return prompt;
    prompt += '\n\n[Bases de datos asignadas: ' + agentKBs.map(kb => kb.name).join(', ') + ' - datos se cargan al ejecutar]';
    return prompt;
}

// Obtiene las filas de una KB usando caché con TTL de 5 minutos
async function getKBRows(kbId) {
    const rowsRef = window.firestore.collection(
        window.db, 'organizations', currentOrganization.id, 'knowledgeBases', kbId, 'rows'
    );

    // Full load with 5-min cache
    const now = Date.now();
    const cached = kbDataCache[kbId];
    if (cached && (now - cached.loadedAt) < KB_CACHE_TTL) {
        return cached.rows;
    }
    const snapshot = await window.firestore.getDocs(rowsRef);
    const rows = [];
    snapshot.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
    kbDataCache[kbId] = { rows, loadedAt: now };
    return rows;
}

// ===== MOTOR DE BÚSQUEDA SEMÁNTICA PARA AUTOPARTES =====

// ===== DETECCIÓN DE CATEGORÍA "PARTE" (SIN TOKENS DE IA) =====
// Mapea cada valor exacto de la columna "parte" a keywords que el usuario podría decir.
// Las frases multi-palabra puntúan más alto → mejor especificidad.
const PARTE_KEYWORDS = {
    'ALERONES':                           ['aleron', 'alerón', 'wing'],
    'ANTIMPACTOS':                        ['antimpacto', 'anti impacto'],
    'BANDAS DEFENSA':                     ['banda defensa', 'tira defensa'],
    'BASE FARO':                          ['base faro', 'soporte faro', 'bracket faro'],
    'BISAGRAS':                           ['bisagra', 'gozne', 'hinge'],
    'BISEL FARO':                         ['bisel faro', 'aro faro', 'marco faro'],
    'BISEL FARO NIEBLA':                  ['bisel faro niebla', 'bisel niebla'],
    'BISEL MANIJA':                       ['bisel manija'],
    'BRACKS':                             ['brack', 'bracket', 'soporte'],
    'CALAVERAS':                          ['calavera', 'stop', 'luz trasera', 'faro trasero'],
    'CARCASA DE ESPEJO':                  ['carcasa espejo', 'concha espejo', 'tapa espejo', 'carcasa retrovisor'],
    'CHAPAS':                             ['chapa', 'cerradura', 'lock'],
    'CHICOTE TAPA BATEA':                 ['chicote', 'cable batea', 'jalador batea'],
    'COFRES':                             ['cofre', 'capo', 'capó', 'hood', 'cofre motor'],
    'CORAZAS':                            ['coraza', 'protector puerta'],
    'COSTADOS':                           ['costado'],
    'CUARTOS FRONTAL':                    ['cuarto frontal', 'cuarto delantero frontal'],
    'CUARTOS LATERALES':                  ['cuarto lateral'],
    'CUARTOS PUNTA':                      ['cuarto punta'],
    'CUARTOS TRASEROS':                   ['cuarto trasero'],
    'DEFENSAS DELANTERAS':                ['defensa delantera', 'defensa frontal', 'bumper delantero', 'defensa del frente'],
    'DEFENSAS TRASERAS':                  ['defensa trasera', 'bumper trasero', 'defensa posterior'],
    'DEPOSITO LIMPIA PARABRISAS':         ['deposito limpia', 'deposito limpiaparabrisas', 'botella agua limpia', 'tanque limpia'],
    'DEPOSITO RECUPERADOR':               ['deposito recuperador', 'tanque recuperador'],
    'ELEVADORES':                         ['elevador', 'elevavidrio', 'regulador vidrio', 'motor vidrio', 'sube baja vidrio'],
    'ESPEJOS':                            ['espejo', 'retrovisor', 'mirror'],
    'FAROS':                              ['faro delantero', 'faro frontal', 'faro principal', 'optico', 'headlight'],
    'FAROS NIEBLA':                       ['faro niebla', 'luz niebla', 'neblinero', 'fog light', 'antiniebla', 'niebla'],
    'FASCIAS DELANTERAS':                 ['fascia delantera', 'fascia frontal', 'fascia del'],
    'FASCIAS TRASERAS':                   ['fascia trasera', 'fascia pos', 'fascia posterior'],
    'FOCOS':                              ['foco', 'bombilla', 'bulbo', 'bulb', 'lamp', 'ampolleta'],
    'FILTROS':                            ['filtro', 'filter'],
    'GUIAS FASCIA':                       ['guia fascia', 'guía fascia', 'guia de fascia'],
    'LUNA ESPEJO':                        ['luna espejo', 'cristal espejo', 'vidrio espejo', 'luna retrovisor'],
    'MANIJAS ELEVADOR':                   ['manija elevador', 'tirador ventana', 'manija sube vidrio'],
    'MANIJAS EXTERIORES':                 ['manija exterior', 'jaladera exterior', 'handle exterior', 'tirador puerta exterior'],
    'MANIJAS INTERIORES':                 ['manija interior', 'jaladera interior', 'handle interior', 'tirador interior'],
    'MANIJAS TAPA BATEA':                 ['manija batea', 'jaladera batea', 'manija tapa batea'],
    'MARCOS PARRILLA':                    ['marco parrilla', 'marco de parrilla'],
    'MARCOS RADIADOR':                    ['marco radiador', 'marco de radiador'],
    'MOLDURAS ARCO':                      ['moldura arco', 'moldura rueda', 'arco rueda', 'moldura guardalodo'],
    'MOLDURAS FARO':                      ['moldura faro', 'moldura de faro'],
    'MOLDURAS FASCIA':                    ['moldura fascia', 'moldura de fascia'],
    'MOLDURAS PARRILLA':                  ['moldura parrilla', 'moldura de parrilla'],
    'MOLDURAS PARRILLA FASCIA':           ['moldura parrilla fascia'],
    'MOLDURA PUERTA':                     ['moldura puerta', 'moldura lateral puerta', 'moldura de puerta'],
    'MOTOVENTILADORES':                   ['motoventilador', 'electroventilador', 'ventilador motor', 'fan motor', 'electroventi'],
    'PARRILLAS':                          ['parrilla', 'grille', 'rejilla frontal'],
    'PARRILLAS DE FASCIA':                ['parrilla fascia', 'rejilla fascia', 'parrilla de fascia'],
    'PORTA PLACAS':                       ['porta placa', 'portaplaca', 'marco placa'],
    'PRODUCTOS SPORT':                    ['sport', 'deportivo', 'tuning'],
    'PRODUCTOS TRACTOCAMION':             ['tractocamion', 'tractocamión', 'tracto camion', 'trailer', 'camion pesado'],
    'PUERTAS':                            ['puerta', 'door', 'panel puerta'],
    'RADIADORES':                         ['radiador', 'radiator'],
    'REFUERZOS DEFENSA DELANTEROS':       ['refuerzo defensa delantera', 'refuerzo delantero defensa'],
    'REFUERZOS DEFENSA TRASEROS':         ['refuerzo defensa trasera', 'refuerzo trasero defensa'],
    'SALPICADERAS':                       ['salpicadera', 'fender', 'aleta', 'guardafango'],
    'SETS':                               ['set de', 'kit de', 'juego de', 'par de'],
    'SPOILERS':                           ['spoiler', 'alerón trasero', 'aleron trasero'],
    'TANQUES DE GASOLINA':                ['tanque gasolina', 'deposito gasolina', 'tanque combustible', 'tanque de gasolina'],
    'TAPAS DE BATEA / TAPAS  CAJUELA':    ['tapa batea', 'tapa cajuela', 'tapa maletero', 'cajuela', 'batea'],
    'TAPA DEFENSA DELANTERA':             ['tapa defensa delantera'],
    'TAPA FASCIA DELANTERA':              ['tapa fascia delantera'],
    'TAPA GUANTERA':                      ['tapa guantera', 'guantera'],
    'TAPON DE LLANTA':                    ['tapon llanta', 'tapa llanta', 'embellecedor llanta', 'wheel cover', 'tapon rueda'],
    'TOLVAS DE COSTADO':                  ['tolva costado', 'tolva de costado'],
    'TOLVAS SALPICADERA':                 ['tolva salpicadera'],
    'TOLVAS CALAVERAS':                   ['tolva calavera', 'tolva stop'],
    'TOLVA INFERIOR MOTOR':               ['tolva inferior motor', 'tolva inferior', 'protector inferior motor', 'under cover'],
    'TOLVAS SUPERIOR DEFENSA':            ['tolva superior defensa'],
    'TOLVAS RADIADOR':                    ['tolva radiador'],
};

/**
 * Detecta el valor de la columna "parte" más probable a partir del texto del usuario.
 * Costo: cero tokens de IA — se ejecuta localmente antes de consultar Firestore.
 *
 * @param {string} text - Mensaje del usuario
 * @returns {string|null} - Valor exacto de la columna "parte", o null si no detectado
 */
function detectParte(text) {
    if (!text) return null;
    const norm = text.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents

    let bestParte = null;
    let bestScore = 0;

    for (const [parte, keywords] of Object.entries(PARTE_KEYWORDS)) {
        let score = 0;
        for (const kw of keywords) {
            const normKw = kw.toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (norm.includes(normKw)) {
                // Frases multi-palabra puntúan más alto → mejor especificidad
                score += normKw.split(/\s+/).length;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestParte = parte;
        }
    }

    return bestScore > 0 ? bestParte : null;
}

// Diccionario bidireccional: términos en español/inglés ↔ abreviaturas de la KB.
// El usuario escribe "eléctrico" → se busca también "ELEC" en las filas.
// Si el usuario escribe "IZQ" → se busca también "izquierdo"/"izquierda".
const AUTOPARTE_EXPANSIONS = {
    // Tipo de accionamiento
    'electrico':     ['elec', 'elect'],
    'eléctrico':     ['elec', 'elect'],
    'electrica':     ['elec', 'elect'],
    'eléctrica':     ['elec', 'elect'],
    'electric':      ['elec', 'elect'],
    'manual':        ['man'],
    // Lado del vehículo
    'derecho':       ['r', 'der', 'dcho', 'dere'],
    'derecha':       ['r', 'der', 'dcha', 'dere'],
    'right':         ['r', 'der'],
    'copiloto':      ['r', 'der', 'dcho', 'dere'],
    'izquierdo':     ['l', 'izq', 'izqdo'],
    'izquierda':     ['l', 'izq', 'izqda'],
    'left':          ['l', 'izq'],
    'piloto':        ['l', 'izq', 'izqdo'],
    // Posición en el vehículo
    'delantero':     ['del', 'front', 'frt', 'delan'],
    'delantera':     ['del', 'front', 'frt', 'delan'],
    'delanteros':    ['del'],
    'delanteras':    ['del'],
    'trasero':       ['tras', 'tra', 'rear', 'post'],
    'trasera':       ['tras', 'tra', 'rear', 'post'],
    'traseros':      ['tras'],
    'traseras':      ['tras'],
    'front':         ['del', 'frt'],
    'rear':          ['tras', 'tra'],
    // Características de espejos y otras piezas
    'direccional':   ['direcc', 'direc', 'c/direcc', 'c/direc'],
    'direccionales': ['direcc', 'c/direcc'],
    'pintar':        ['p/pintar', 'p/p'],
    'pintada':       ['p/pintar', 'p/p'],
    'pintura':       ['p/pintar', 'p/p'],
    'texturizado':   ['text', 'textu'],
    'texturizada':   ['text', 'textu'],
    'textured':      ['text'],
    'autoabatible':  ['autoab', 'e/abatible'],
    'autofold':      ['autoab', 'e/abatible'],
    'abatible':      ['autoab', 'e/abatible', 'abatible'],
    'control':       ['c/cont', 'cont'],
    'controlable':   ['c/cont'],
    // Expansión inversa: cuando el usuario escribe la abreviatura
    'elec':          ['electrico', 'eléctrico'],
    'elect':         ['electrico', 'eléctrico'],
    'man':           ['manual'],
    'der':           ['derecho', 'derecha'],
    'izq':           ['izquierdo', 'izquierda'],
    'tras':          ['trasero', 'trasera'],
    'text':          ['texturizado', 'texturizada'],
    'autoab':        ['autoabatible', 'abatible'],
    'direcc':        ['direccional'],
    'cont':          ['control'],
};

/**
 * Normaliza año de 2 dígitos a 4 dígitos.
 * 00-29 → 2000-2029 | 30-99 → 1930-1999
 */
function normalizeYear(twoDigitStr) {
    const n = parseInt(twoDigitStr, 10);
    return n <= 29 ? 2000 + n : 1900 + n;
}

/**
 * Extrae todos los rangos de años (XX-XX o XXXX-XXXX) del texto de una fila.
 * Ejemplo: "SENTRA 01-06" → [{from:2001, to:2006}]
 * @returns {{ from: number, to: number }[]}
 */
function extractYearRanges(text) {
    const ranges = [];
    const re = /(?<!\d)(\d{2}|\d{4})-(\d{2}|\d{4})(?!\d)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        let from = parseInt(m[1], 10);
        let to   = parseInt(m[2], 10);
        if (from < 100) from = normalizeYear(m[1]);
        if (to   < 100) to   = normalizeYear(m[2]);
        if (from >= 1930 && to <= 2030 && from <= to) {
            ranges.push({ from, to });
        }
    }
    return ranges;
}

/**
 * Detecta años en la consulta del usuario.
 * Maneja: 4 dígitos (1993, 2004) y 2 dígitos solos separados por espacios/comas.
 * NO interpreta rangos como "88-94" como años separados.
 * @returns {number[]}
 */
function extractQueryYears(text) {
    const years = new Set();
    // Años de 4 dígitos en rango razonable para vehículos
    const re4 = /\b(19[3-9]\d|20[0-2]\d)\b/g;
    let m;
    while ((m = re4.exec(text)) !== null) years.add(parseInt(m[1], 10));
    // Años de 2 dígitos SOLOS (no parte de un rango XX-XX ni de número mayor)
    const re2 = /(?:^|[\s,\/])(\d{2})(?:[\s,\/]|$)/g;
    while ((m = re2.exec(text)) !== null) years.add(normalizeYear(m[1]));
    return [...years];
}

/**
 * Expande los términos de búsqueda del usuario con el diccionario de abreviaturas.
 * Retorna el Set de todos los términos a buscar (originales + expansiones)
 * y el array de años detectados.
 * @returns {{ terms: Set<string>, years: number[] }}
 */
function expandSearchTerms(text) {
    if (!text) return { terms: new Set(), years: [] };

    const stopwords = new Set([
        'el','la','los','las','un','una','unos','unas','en',
        'con','por','para','que','qué','es','son','hay','tiene','tienen',
        'me','te','se','le','lo','y','o','a','e','i','u',
        'como','cómo','si','no','sí','más','muy','también','ya','mi','tu',
        'su','this','the','is','are','do','does','what','how','have','has',
        'al','de',
    ]);

    const years  = extractQueryYears(text);
    const tokens = text
        .toLowerCase()
        .split(/[\s,;.!?]+/)
        .map(t => t.trim())
        .filter(t => t.length > 0 && !stopwords.has(t));

    const terms = new Set();
    for (const token of tokens) {
        if (/^\d{4}$/.test(token) && parseInt(token) >= 1930 && parseInt(token) <= 2030) continue;
        if (/^\d{2}$/.test(token)) continue;
        if (/[a-záéíóúüñ]/i.test(token)) terms.add(token);
        for (const exp of (AUTOPARTE_EXPANSIONS[token] || [])) terms.add(exp.toLowerCase());
    }

    // Normalización de plurales en español: "faros" → también buscar "faro"
    // Resuelve el caso en que el usuario escribe el plural pero la KB tiene el singular.
    const singulars = [];
    for (const term of terms) {
        if (term.length >= 4 && term.endsWith('s') && /[a-záéíóúüñ]/.test(term)) {
            singulars.push(term.slice(0, -1)); // "faros"→"faro", "espejos"→"espejo"
        }
    }
    for (const s of singulars) terms.add(s);

    return { terms, years };
}

/**
 * Calcula la relevancia de una fila frente a los términos expandidos y años.
 *
 * - Tokens de 1-2 chars (R, L, MAN…): token exacto para evitar falsos positivos
 *   (ej. "R" no debe matchear "SIERRA", "CORSA" o "CHEVROLET").
 * - Tokens de 3+ chars: matching de subcadena (incluye abreviaturas como TRAS, ELEC).
 * - Años: se extraen rangos XX-XX de la descripción y se comprueba si el año
 *   del usuario cae dentro. Si hay rangos pero ninguno coincide, leve penalización.
 *
 * @param {object}       row
 * @param {Set<string>}  terms
 * @param {number[]}     years
 * @returns {number}  0 = sin match, mayor = más relevante
 */
function scoreRow(row, terms, years) {
    const rowText = Object.values(row).map(v => String(v ?? '')).join(' ').toLowerCase();
    // Tokenizar filas preservando abreviaturas con barra (P/P, C/CONT, E/ABATIBLE)
    const rowTokens = new Set(
        rowText.split(/\s+/).map(t => t.replace(/^[.,;:()\[\]]+|[.,;:()\[\]]+$/g, ''))
    );

    let score = 0;
    for (const term of terms) {
        if (term.length <= 2) {
            // Token exacto para términos cortos (R, L, P/P tiene longitud 3 → substring)
            if (rowTokens.has(term)) score += (term.length === 1 ? 4 : 2);
        } else {
            if (rowText.includes(term)) score += 1;
        }
    }

    if (years.length > 0) {
        const ranges = extractYearRanges(rowText);
        // 1. Coincidencia por rango (ej. "2018-2022" contiene 2020)
        const rangeMatch = years.some(y => ranges.some(r => y >= r.from && y <= r.to));
        // 2. Coincidencia por año exacto en el texto (ej. la KB guarda "2020" suelto)
        const exactMatch = years.some(y => new RegExp(`(?<!\\d)${y}(?!\\d)`).test(rowText));
        if (rangeMatch || exactMatch) {
            score += 5;
        }
        // Se elimina la penalización: una parte con año distinto puede ser compatible
        // y el AI decide; la penalización causaba falsos negativos.
    }
    return score;
}

// Versión asíncrona que carga datos filtrados de Firestore y los embebe en el prompt
// userMessage: último mensaje del usuario para filtrar filas relevantes (máx 30)
async function buildAISystemPromptWithData(agent, userMessage) {
    let prompt = agent.systemPrompt || '';

    prompt += '\n\n---\nREGLAS OBLIGATORIAS:\n';
    prompt += '- Responde directo. No narres proceso interno ("déjame buscar...", "consultando...").\n';
    prompt += '- Sin XML/JSON/código/nombres de herramientas en respuestas al cliente.\n';
    prompt += '- No inventes precios, existencias ni números de pedido.\n';
    prompt += '- DEBES LLAMAR las herramientas para ejecutar acciones. NUNCA simules que ya lo hiciste. Si no llamaste save_contact, el contacto NO se guardó. Si no llamaste create_order, el pedido NO se creó.\n';
    prompt += '- PROHIBIDO terminar la conversación sin haber llamado save_contact Y create_order. Ambas son OBLIGATORIAS en cada cotización.\n\n';

    prompt += 'FLUJO OBLIGATORIO (DEBES completar TODOS los pasos, sin excepción):\n';
    const agentKbIds = agent.knowledgeBases || [];
    if (agentKbIds.length > 0) {
        prompt += '1. BUSCAR → Llama query_database con marca, modelo, parte, anio, lado. Nunca digas "no tenemos" sin buscar primero.\n';
    }
    prompt += '2. CONTACTO → OBLIGATORIO: Después de cotizar, pide AL CLIENTE TODOS estos datos uno por uno para guardar su contacto:\n';
    prompt += '   - Nombre completo (obligatorio)\n';
    prompt += '   - Número de celular (obligatorio)\n';
    prompt += '   - Empresa o taller\n';
    prompt += '   - Correo electrónico\n';
    prompt += '   - Dirección de envío\n';
    prompt += '   - RFC (si requiere factura)\n';
    prompt += '   Una vez que tengas al menos nombre y celular, LLAMA save_contact INMEDIATAMENTE con todos los datos recopilados. NO sigas sin llamar a save_contact.\n';
    prompt += '3. PEDIDO → OBLIGATORIO: Inmediatamente después de save_contact, LLAMA create_order con los productos cotizados, sus cantidades y precios. NO esperes confirmación adicional — el hecho de que el cliente pidió cotización y dio sus datos ES la confirmación. Comparte al cliente el número de pedido que DEVUELVA la herramienta.\n';
    prompt += '- Orden estricto: save_contact SIEMPRE ANTES de create_order. Ambos son OBLIGATORIOS.\n';
    prompt += '- Si el cliente ya dio nombre y celular en la conversación, NO los vuelvas a pedir — usa los que ya tienes y llama save_contact de inmediato.\n';
    prompt += '- NUNCA termines la conversación solo con la cotización. SIEMPRE debes guardar contacto y crear pedido.\n\n';

    if (agentKbIds.length > 0) {
        for (const kbId of agentKbIds) {
            const kb = knowledgeBases.find(k => k.id === kbId);
            if (kb) {
                prompt += `Base "${kb.name}": columnas: ${(kb.columns || []).join(', ')}.\n`;
            }
        }
        prompt += 'Usa query_database para buscar productos en estas bases.\n';
    }

    return prompt;
}

// Genera las tool definitions para el agente IA.
// save_contact siempre está disponible; query_database solo si tiene KBs.
function buildAIToolDefinitions(agent) {
    const tools = [];

    // --- Herramienta 1: guardar datos del contacto ---
    tools.push({
        type: 'function',
        function: {
            name: 'save_contact',
            description: 'OBLIGATORIO en cada cotización. Guarda o actualiza contacto en CRM. DEBES pedir: nombre completo, celular, empresa/taller, email, dirección y RFC. Mínimo nombre + celular. DEBES llamar esta función ANTES de create_order. Si no la llamas, el contacto NO se guarda.',
            parameters: {
                type: 'object',
                properties: {
                    name:    { type: 'string', description: 'Nombre completo' },
                    company: { type: 'string', description: 'Empresa o taller' },
                    phone:   { type: 'string', description: 'Número de celular (OBLIGATORIO para deduplicación)' },
                    email:   { type: 'string', description: 'Correo electrónico' },
                    address: { type: 'string', description: 'Dirección' },
                    rfc:     { type: 'string', description: 'RFC' },
                    notes:   { type: 'string', description: 'Notas' },
                },
                required: ['name', 'phone'],
            },
        },
    });

    // --- Herramienta 2: crear pedido ---
    tools.push({
        type: 'function',
        function: {
            name: 'create_order',
            description: 'OBLIGATORIO en cada cotización. Crea el pedido con los productos cotizados. REQUISITO: save_contact DEBE haberse llamado antes. DEBES llamar esta función después de guardar el contacto — NO esperes confirmación extra del cliente. La herramienta devuelve el número de pedido — compártelo al cliente.',
            parameters: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        description: 'Lista de productos del pedido',
                        items: {
                            type: 'object',
                            properties: {
                                product:   { type: 'string', description: 'Nombre del producto o servicio' },
                                sku:       { type: 'string', description: 'SKU o código del producto tal como aparece en la base de datos' },
                                quantity:  { type: 'number', description: 'Cantidad solicitada' },
                                unitPrice: { type: 'number', description: 'Precio unitario (sin símbolo de moneda, solo número)' },
                                notes:     { type: 'string', description: 'Notas adicionales del producto' }
                            },
                            required: ['product', 'quantity']
                        }
                    },
                    notes: { type: 'string', description: 'Notas generales del pedido' }
                },
                required: ['items']
            }
        }
    });

    // --- Herramienta 3: consultar base de datos (solo si hay KBs) ---
    // Usar los IDs raw del agente como fuente de verdad para el enum.
    // No depender de que el metadata esté cargado en el array global knowledgeBases:
    // si no está cargado, la herramienta se omite incorrectamente y el modelo
    // genera pseudo-XML en lugar de un tool_use real.
    const agentKbIds = agent.knowledgeBases || [];
    const agentKBsMeta = agentKbIds
        .map(kbId => knowledgeBases.find(kb => kb.id === kbId))
        .filter(Boolean);

    if (agentKbIds.length > 0) {
        const basesInfo = agentKBsMeta.length > 0
            ? agentKBsMeta.map(kb => `"${kb.name}" (${(kb.columns || []).join(', ')})`).join('; ')
            : agentKbIds.join(', ');
        tools.push({
            type: 'function',
            function: {
                name: 'query_database',
                description: 'Consulta la base de datos de productos. DEBES llamar a esta función SIEMPRE que el cliente pregunte por una pieza o producto específico. Los datos del system prompt son solo una muestra parcial del inventario — si no ves el producto ahí, NO asumas que no existe: búscalo aquí primero. Úsala también para obtener precios exactos, SKUs y disponibilidad. '
                    + 'Bases disponibles: ' + basesInfo,
                parameters: {
                    type: 'object',
                    properties: {
                        knowledgeBaseId: {
                            type: 'string',
                            description: 'ID de la base de datos a consultar',
                            enum: agentKbIds,
                        },
                        searchQuery: {
                            type: 'string',
                            description: 'Texto de búsqueda: describe el producto con marca, modelo, año, SKU u otras características',
                        },
                        limit: {
                            type: 'number',
                            description: 'Máximo de resultados a devolver (default: 25, máx: 50)',
                        },
                    },
                    required: ['knowledgeBaseId', 'searchQuery'],
                },
            },
        });
    }

    return tools;
}

// Ejecuta la herramienta save_contact: crea o actualiza el contacto en Firestore
// y lo vincula a la conversación activa.
async function saveContactFromAI(contactData) {
    if (!currentOrganization || !currentConversation) {
        return { success: false, message: 'No hay conversación activa.' };
    }
    try {
        const data = { ...contactData };
        if (data.rfc) data.rfc = data.rfc.toUpperCase();

        // Verificar si el contactId actual apunta a un documento real de Firestore
        const existingContactId = currentConversation.contactId;
        let isRealContact = false;
        if (existingContactId) {
            const snap = await window.firestore.getDoc(
                window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'contacts', existingContactId)
            );
            isRealContact = snap.exists();
        }

        if (isRealContact) {
            await window.firestore.updateDoc(
                window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'contacts', existingContactId),
                { ...data, updatedAt: window.firestore.serverTimestamp() }
            );
            const idx = contacts.findIndex(c => c.id === existingContactId);
            if (idx !== -1) contacts[idx] = { ...contacts[idx], ...data, updatedAt: new Date() };
            return { success: true, action: 'updated', name: data.name };
        } else {
            const docRef = await window.firestore.addDoc(
                window.firestore.collection(window.db, 'organizations', currentOrganization.id, 'contacts'),
                {
                    ...data,
                    funnelStage: 'curioso',
                    createdAt: window.firestore.serverTimestamp(),
                    updatedAt: window.firestore.serverTimestamp(),
                }
            );
            await window.firestore.updateDoc(
                window.firestore.doc(window.db, 'organizations', currentOrganization.id, 'conversations', currentConversation.id),
                { contactId: docRef.id, contactName: data.name, contactPhone: data.phone || '' }
            );
            currentConversation.contactId   = docRef.id;
            currentConversation.contactName = data.name;
            contacts.push({ id: docRef.id, ...data, funnelStage: 'curioso', createdAt: new Date(), updatedAt: new Date() });
            return { success: true, action: 'created', name: data.name, contactId: docRef.id };
        }
    } catch (err) {
        console.error('Error guardando contacto desde IA:', err);
        return { success: false, message: err.message };
    }
}

// Ejecuta una consulta a la base de datos (usa caché interna).
// Devuelve texto formateado listo para la IA — nunca JSON crudo ni precio_compra.
async function queryKnowledgeBase(kbId, searchQuery, filters, limit = 25) {
    if (!currentOrganization) return 'Error: no hay organización activa.';

    // No hacer consulta a Firebase si no hay búsqueda ni filtros definidos
    const hasQuery = searchQuery && searchQuery.trim().length > 0;
    const hasFilters = filters && typeof filters === 'object' && Object.keys(filters).length > 0;
    if (!hasQuery && !hasFilters) return 'No se especificó ningún criterio de búsqueda.';

    try {
        let rows = await getKBRows(kbId);

        if (rows.length === 0) return 'No se encontraron productos en la base de datos.';

        // Scoring semántico: retornar sólo filas relevantes (score > 0).
        // Si ninguna puntúa, devolver todas ordenadas como fallback.
        if (searchQuery) {
            const { terms: qTerms, years: qYears } = expandSearchTerms(searchQuery);
            if (qTerms.size > 0 || qYears.length > 0) {
                const scored = rows
                    .map(row => ({ row, score: scoreRow(row, qTerms, qYears) }))
                    .sort((a, b) => b.score - a.score);
                const matched = scored.filter(({ score }) => score > 0);
                rows = matched.length > 0
                    ? matched.map(({ row }) => row)
                    : scored.map(({ row }) => row);
            }
        }

        // Aplicar filtros de columna adicionales
        if (hasFilters) {
            Object.entries(filters).forEach(([key, value]) => {
                rows = rows.filter(row => {
                    const rowVal = String(row[key] || '').toLowerCase();
                    return rowVal.includes(String(value).toLowerCase());
                });
            });
        }

        const total = rows.length;
        rows = rows.slice(0, Math.min(limit, 50));

        // Formatear como texto legible, excluyendo precio_compra (confidencial)
        const columns = Object.keys(rows[0] || {}).filter(k => k !== 'id' && k !== 'precio_compra');
        const formatted = rows.map((row, i) => {
            return `${i + 1}. ${columns.map(col => `${col}: ${row[col] ?? ''}`).join(' | ')}`;
        }).join('\n');

        const totalInfo = total > rows.length ? ` (top ${rows.length} de ${total})` : ` (${rows.length})`;
        return `Resultados${totalInfo}:\n${formatted}`;
    } catch (error) {
        console.error('Error consultando base de datos:', error);
        return 'Error al consultar la base de datos.';
    }
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
        closeIntegrationConfig();
        closeNewChatModal();
        closePaymentLinkModal();
        closeAIAgentModal();
        closeExcelUploadModal();
        closeAITestModal();
        document.getElementById('notificationsPanel')?.classList.add('hidden');
    }
});

// Inicializacion
console.log('MessageHub SaaS inicializado');
