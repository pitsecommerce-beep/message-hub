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
        if (userData.role !== 'agente') {
            await loadIntegrationConfigs();
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
    document.getElementById('teamCount').textContent = teamMembers.length;
}

// ========== NAVEGACION DE PAGINAS ==========

function showPage(page) {
    // Bloquear acceso a Integraciones y Agentes IA para agentes
    if ((page === 'integrations' || page === 'aiAgents') && currentUserData && currentUserData.role === 'agente') {
        showNotification('Acceso restringido', 'Esta sección solo está disponible para gerentes y administradores.', 'warning');
        return;
    }

    const pages = ['dashboard', 'conversations', 'contacts', 'team', 'integrations', 'aiAgents', 'settings'];
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
    } else if (page === 'integrations') {
        loadIntegrationConfigs();
    } else if (page === 'aiAgents') {
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
        const webhookUrl = `https://us-central1-crm-meta-e56f4.cloudfunctions.net/webhook/${platform}`;
        html += `
            <div class="integ-webhook-note">
                <span class="integ-webhook-label">${config.webhookNote}</span>
                <div class="integ-webhook-url">
                    <code>${webhookUrl}</code>
                    <button class="copy-btn" onclick="navigator.clipboard.writeText('${webhookUrl}')" title="Copiar">📋</button>
                </div>
                <span class="integ-webhook-hint">Copia esta URL y pégala en la configuración de webhook de tu app en Meta for Developers.</span>
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

// ========== SISTEMA DE CHAT / CONVERSACIONES ==========

let conversations = [];
let currentConversation = null;
let currentConvFilter = 'all';
let messagesUnsubscribe = null;
let selectedChatPlatform = null;
let selectedPaymentGateway = null;
let currentConvPaymentLinks = [];
let aiAgents = [];

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
    document.getElementById('paymentLinkAmount').value = '';
    document.getElementById('paymentLinkDescription').value = '';
    document.getElementById('paymentLinkNotes').value = '';
    selectedPaymentGateway = null;
    document.querySelectorAll('input[name="paymentGateway"]').forEach(r => r.checked = false);
    document.querySelectorAll('#paymentLinkModal .platform-option-card').forEach(c => c.classList.remove('selected'));

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
            createdAt: window.firestore.serverTimestamp(),
            createdBy: currentUser.uid,
            createdByName: userName
        };

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
        if (currentConversation.funnelStage && earlyStages.includes(currentConversation.funnelStage)) {
            await changeConvStage(currentConversation.id, 'pago_pendiente');
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
            assignedTo: currentUser.uid
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

    if (agent) {
        title.textContent = 'Editar Agente IA';
        editId.value = agent.id;
        document.getElementById('aiAgentName').value = agent.name || '';
        document.getElementById('aiAgentProvider').value = agent.provider || '';
        onAIProviderChange();
        // Set model after provider change rebuilds the select
        setTimeout(() => {
            const modelEl = document.getElementById('aiAgentModel');
            if (modelEl) modelEl.value = agent.model || '';
        }, 50);
        document.getElementById('aiAgentApiKey').value = agent.apiKey || '';
        document.getElementById('aiAgentEndpoint').value = agent.endpoint || '';
        document.getElementById('aiAgentSystemPrompt').value = agent.systemPrompt || '';
        document.getElementById('aiAgentActive').checked = agent.isActive !== false;

        // Channels
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

        // Reset model select
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

    const agentData = {
        name,
        provider,
        model,
        apiKey,
        endpoint: provider === 'custom' ? endpoint : '',
        systemPrompt,
        isActive,
        channels,
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
        document.getElementById('notificationsPanel')?.classList.add('hidden');
    }
});

// Inicializacion
console.log('MessageHub SaaS inicializado');
