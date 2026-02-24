function login() {
    const user = document.getElementById("user").value;
    const pass = document.getElementById("pass").value;

    if(user === "admin" && pass === "1234") {
        localStorage.setItem("logged", "true");
        alert("Login sucesso!");
        window.location.href = "login2.html";
    } else {
        alert("Usuário ou senha incorretos!");
    }
}

function login2() {
    const code = document.getElementById("code").value;

    if(code === "0000") {
        alert("Verificação concluída!");
        window.location.href = "game.html";
    } else {
        alert("Código inválido!");
    }
}

function checkLogin() {
    if(localStorage.getItem("logged") !== "true") {
        window.location.href = "login.html";
    }
}
