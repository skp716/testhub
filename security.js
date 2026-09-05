// 1. Text Selection aur Right-Click Disable Karna
document.addEventListener('contextmenu', event => event.preventDefault());

document.addEventListener('copy', (e) => {
    e.preventDefault();
    alert("Copying content is disabled!");
});

document.addEventListener('paste', (e) => {
    e.preventDefault();
});

// 2. Tab Switching Detect Karna
document.addEventListener("visibilitychange", function() {
    if (document.hidden) {
        alert("Warning: Aapne tab switch kiya hai! Aapka test submit ho sakta hai.");
        // Agar auto-submit karna hai toh yahan function call karein
    }
});

// 3. Print (Ctrl+P) aur Kuch Keys Block Karna
document.addEventListener("keydown", function(e) {
    // Ctrl+P block karne ke liye
    if (e.ctrlKey && (e.key === 'p' || e.keyCode === 80)) {
        e.preventDefault();
        alert("Printing is disabled!");
    }
    // F12 (DevTools) block karne ki koshish
    if (e.key === "F12") {
        e.preventDefault();
        alert("Developer tools are disabled!");
    }
});
