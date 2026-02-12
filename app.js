// MessageHub SaaS - Application Logic

// Global state
let currentUser = null;
let currentOrganization = null;
let selectedRole = null;

// ========== NOTIFICATION FUNCTIONS ==========

function showNotification(title, message, type = 'error') {
    const overlay = document.getElementById('notificationOverlay');
    const box = document.getElementById('notificationBox');
    const iconEl = document.getElementById('notificationIcon');
    const titleEl = document.getElementById('notificationTitle');
    const messageEl = document.getElementById('notificationMessage');

    iconEl.textContent = type === 'error' ? '⚠️' : 'ℹ️';
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
                message: `El dominio actual (${currentDomain}) no está autorizado para inicio de sesión con OAuth (Google/Facebook).\n\n` +
                    `Para solucionarlo:\n` +
                    `1. Ve a Firebase Console:\n   https://console.firebase.google.com\n` +
                    `2. Selecciona tu proyecto\n` +
                    `3. Ve a Authentication → Settings → Authorized domains\n` +
                    `4. Haz clic en "Add domain" y agrega:\n   ${currentDomain}\n\n` +
                    `Mientras tanto, puedes iniciar sesión con email y contraseña.`
            };
        case 'auth/popup-blocked':
            return {
                title: 'Ventana bloqueada',
                message: 'El navegador bloqueó la ventana emergente de inicio de sesión.\n\nPor favor, permite ventanas emergentes para este sitio e intenta de nuevo.'
            };
        case 'auth/popup-closed-by-user':
            return {
                title: 'Inicio de sesión cancelado',
                message: 'Se cerró la ventana de inicio de sesión antes de completar el proceso.'
            };
        case 'auth/account-exists-with-different-credential':
            return {
                title: 'Cuenta existente',
                message: 'Ya existe una cuenta con este email usando otro método de inicio de sesión. Intenta con el método original.'
            };
        case 'auth/cancelled-popup-request':
            return null; // Ignore silently
        default:
            return {
                title: 'Error de autenticación',
                message: error.message
            };
    }
}

// ========== AUTH FUNCTIONS ==========

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

// Handle login form submission
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
        console.error('Login error:', error);
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) {
            showNotification(errorInfo.title, errorInfo.message, 'error');
        }
        btnText.textContent = 'Sign In';
        btn.disabled = false;
    }
});

// Handle register form submission
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const btnText = document.getElementById('registerBtnText');
    const btn = document.getElementById('registerBtn');
    
    if (password.length < 6) {
        alert('Password must be at least 6 characters');
        return;
    }
    
    btnText.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;
    
    try {
        const userCredential = await window.firebaseAuth.createUserWithEmailAndPassword(
            window.auth, email, password
        );
        
        await window.firebaseAuth.updateProfile(userCredential.user, {
            displayName: name
        });
        
        // Create user document
        await window.firestore.setDoc(
            window.firestore.doc(window.db, 'users', userCredential.user.uid),
            {
                name: name,
                email: email,
                createdAt: window.firestore.serverTimestamp(),
                onboarded: false
            }
        );
    } catch (error) {
        console.error('Registration error:', error);
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) {
            showNotification(errorInfo.title, errorInfo.message, 'error');
        }
        btnText.textContent = 'Create Account';
        btn.disabled = false;
    }
});

async function handleGoogleAuth() {
    try {
        const provider = new window.firebaseAuth.GoogleAuthProvider();
        const result = await window.firebaseAuth.signInWithPopup(window.auth, provider);

        const userDoc = await window.firestore.getDoc(
            window.firestore.doc(window.db, 'users', result.user.uid)
        );

        if (!userDoc.exists()) {
            await window.firestore.setDoc(
                window.firestore.doc(window.db, 'users', result.user.uid),
                {
                    name: result.user.displayName,
                    email: result.user.email,
                    createdAt: window.firestore.serverTimestamp(),
                    onboarded: false
                }
            );
        }
    } catch (error) {
        console.error('Google auth error:', error);
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) {
            showNotification(errorInfo.title, errorInfo.message, 'error');
        }
    }
}

async function handleFacebookAuth() {
    try {
        const provider = new window.firebaseAuth.FacebookAuthProvider();
        const result = await window.firebaseAuth.signInWithPopup(window.auth, provider);

        const userDoc = await window.firestore.getDoc(
            window.firestore.doc(window.db, 'users', result.user.uid)
        );

        if (!userDoc.exists()) {
            await window.firestore.setDoc(
                window.firestore.doc(window.db, 'users', result.user.uid),
                {
                    name: result.user.displayName,
                    email: result.user.email,
                    createdAt: window.firestore.serverTimestamp(),
                    onboarded: false
                }
            );
        }
    } catch (error) {
        console.error('Facebook auth error:', error);
        const errorInfo = getFirebaseAuthErrorMessage(error);
        if (errorInfo) {
            showNotification(errorInfo.title, errorInfo.message, 'error');
        }
    }
}

async function handleLogout() {
    try {
        await window.firebaseAuth.signOut(window.auth);
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// ========== ONBOARDING FUNCTIONS ==========

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
    
    if (selectedRole === 'admin') {
        document.getElementById('adminSetup').classList.remove('hidden');
        document.getElementById('agentSetup').classList.add('hidden');
    } else {
        document.getElementById('adminSetup').classList.add('hidden');
        document.getElementById('agentSetup').classList.remove('hidden');
    }
}

// Handle organization creation
document.getElementById('orgForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const orgName = document.getElementById('orgName').value;
    const orgIndustry = document.getElementById('orgIndustry').value;
    const btnText = document.getElementById('orgBtnText');
    
    btnText.innerHTML = '<span class="spinner"></span>';
    
    try {
        const orgId = generateOrgId();
        const inviteCode = generateInviteCode();
        
        // Create organization
        await window.firestore.setDoc(
            window.firestore.doc(window.db, 'organizations', orgId),
            {
                name: orgName,
                industry: orgIndustry,
                ownerId: currentUser.uid,
                inviteCode: inviteCode,
                createdAt: window.firestore.serverTimestamp(),
                members: [currentUser.uid]
            }
        );
        
        // Update user document
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'users', currentUser.uid),
            {
                organizationId: orgId,
                role: 'admin',
                onboarded: true
            }
        );
        
        // Show invite code
        alert(`Organization created!\n\nYour invite code: ${inviteCode}\n\nShare this with team members to invite them.`);
        
        // Load app
        await loadApp(currentUser.uid);
    } catch (error) {
        console.error('Organization creation error:', error);
        alert('Error: ' + error.message);
        btnText.textContent = 'Create Organization';
    }
});

// Handle joining organization
document.getElementById('joinForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const inviteCode = document.getElementById('inviteCode').value.toUpperCase();
    const btnText = document.getElementById('joinBtnText');
    
    btnText.innerHTML = '<span class="spinner"></span>';
    
    try {
        // Find organization with invite code
        const orgsQuery = window.firestore.query(
            window.firestore.collection(window.db, 'organizations'),
            window.firestore.where('inviteCode', '==', inviteCode)
        );
        
        const orgsSnapshot = await window.firestore.getDocs(orgsQuery);
        
        if (orgsSnapshot.empty) {
            alert('Invalid invite code');
            btnText.textContent = 'Join Organization';
            return;
        }
        
        const orgDoc = orgsSnapshot.docs[0];
        const orgId = orgDoc.id;
        
        // Add user to organization
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'organizations', orgId),
            {
                members: [...orgDoc.data().members, currentUser.uid]
            }
        );
        
        // Update user document
        await window.firestore.updateDoc(
            window.firestore.doc(window.db, 'users', currentUser.uid),
            {
                organizationId: orgId,
                role: 'agent',
                onboarded: true
            }
        );
        
        // Load app
        await loadApp(currentUser.uid);
    } catch (error) {
        console.error('Join organization error:', error);
        alert('Error: ' + error.message);
        btnText.textContent = 'Join Organization';
    }
});

// ========== APP FUNCTIONS ==========

async function handleUserLogin(user) {
    currentUser = user;
    
    // Get user document
    const userDoc = await window.firestore.getDoc(
        window.firestore.doc(window.db, 'users', user.uid)
    );
    
    if (!userDoc.exists()) {
        showAuthPage();
        return;
    }
    
    const userData = userDoc.data();
    
    // Check if onboarded
    if (!userData.onboarded) {
        showOnboardingPage();
    } else {
        await loadApp(user.uid);
    }
}

function showAuthPage() {
    document.getElementById('authPage').style.display = 'flex';
    document.getElementById('onboardingPage').classList.add('hidden');
    document.getElementById('appLayout').classList.remove('active');
}

function showOnboardingPage() {
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('onboardingPage').classList.remove('hidden');
    document.getElementById('appLayout').classList.remove('active');
}

async function loadApp(userId) {
    // Hide auth and onboarding
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('onboardingPage').classList.add('hidden');
    
    // Load user data
    const userDoc = await window.firestore.getDoc(
        window.firestore.doc(window.db, 'users', userId)
    );
    const userData = userDoc.data();
    
    // Load organization data
    const orgDoc = await window.firestore.getDoc(
        window.firestore.doc(window.db, 'organizations', userData.organizationId)
    );
    currentOrganization = { id: orgDoc.id, ...orgDoc.data() };
    
    // Update UI
    const userName = userData.name || currentUser.email.split('@')[0];
    const userInitial = userName.charAt(0).toUpperCase();
    
    document.getElementById('userName').textContent = userName;
    document.getElementById('userRole').textContent = userData.role === 'admin' ? 'Admin' : 'Agent';
    document.getElementById('userAvatar').textContent = userInitial;
    document.getElementById('orgNameDisplay').textContent = currentOrganization.name;
    
    // Load team members
    await loadTeamMembers();
    
    // Show app
    document.getElementById('appLayout').classList.add('active');
}

async function loadTeamMembers() {
    const teamGrid = document.getElementById('teamGrid');
    const allTeamGrid = document.getElementById('allTeamGrid');
    
    const members = [];
    
    for (const memberId of currentOrganization.members) {
        const memberDoc = await window.firestore.getDoc(
            window.firestore.doc(window.db, 'users', memberId)
        );
        if (memberDoc.exists()) {
            members.push({ id: memberId, ...memberDoc.data() });
        }
    }
    
    const memberHTML = members.map(member => {
        const initial = member.name.charAt(0).toUpperCase();
        const role = member.role === 'admin' ? 'Admin' : 'Agent';
        return `
            <div class="team-member">
                <div class="team-avatar">${initial}</div>
                <div class="team-info">
                    <div class="team-name">${member.name}</div>
                    <div class="team-role">${role}</div>
                </div>
                <div class="team-status"></div>
            </div>
        `;
    }).join('');
    
    teamGrid.innerHTML = memberHTML;
    if (allTeamGrid) {
        allTeamGrid.innerHTML = memberHTML;
    }
    
    document.getElementById('teamCount').textContent = members.length;
}

function showPage(page) {
    // Hide all pages
    const pages = ['dashboard', 'conversations', 'contacts', 'team', 'integrations', 'settings'];
    pages.forEach(p => {
        document.getElementById(p + 'Page').classList.add('hidden');
    });
    
    // Show selected page
    document.getElementById(page + 'Page').classList.remove('hidden');
    
    // Update navigation
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    event.target.closest('.nav-item').classList.add('active');
    
    // Update page title
    const titles = {
        dashboard: { title: 'Dashboard', subtitle: 'Overview of your messaging activity' },
        conversations: { title: 'Conversations', subtitle: 'Manage all your conversations' },
        contacts: { title: 'Contacts', subtitle: 'Your contact directory' },
        team: { title: 'Team', subtitle: 'Manage your team members' },
        integrations: { title: 'Integrations', subtitle: 'Connect your messaging platforms' },
        settings: { title: 'Settings', subtitle: 'Organization settings and preferences' }
    };
    
    document.getElementById('pageTitle').textContent = titles[page].title;
    document.getElementById('pageSubtitle').textContent = titles[page].subtitle;
}

function inviteTeamMember() {
    if (currentOrganization && currentOrganization.inviteCode) {
        const message = `Share this invite code with your team:\n\n${currentOrganization.inviteCode}\n\nThey can use it during signup to join your organization.`;
        
        // Try to copy to clipboard
        if (navigator.clipboard) {
            navigator.clipboard.writeText(currentOrganization.inviteCode).then(() => {
                alert(message + '\n\n✅ Code copied to clipboard!');
            }).catch(() => {
                alert(message);
            });
        } else {
            alert(message);
        }
    }
}

// ========== UTILITY FUNCTIONS ==========

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

// Initialize app
console.log('MessageHub SaaS initialized');
