import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Leaf } from "lucide-react";
import { register } from "@/lib/api";
import beachHero from "@/assets/beach-hero.jpeg";
import "./Cadastro.css";

const schema = z
  .object({
    name: z.string().trim().min(3, "Nome deve ter pelo menos 3 caracteres").max(80),
    email: z.string().trim().email("E-mail inválido").max(255),
    password: z.string().min(6, "Mínimo 6 caracteres").max(72),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "As senhas não coincidem",
    path: ["confirm"],
  });

const Signup = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      schema.parse({ name, email, password, confirm });

      await register({ nome: name, email, senha: password });
      navigate("/login");
    } catch (err) {
      if (err instanceof z.ZodError) {
        setError(err.errors[0].message);
      } else if (err instanceof Error) {
        setError(err.message || "Falha ao criar conta");
      } else {
        setError("Erro desconhecido");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="register-page"
      style={{ backgroundImage: `url(${beachHero})` }}
    >
      <div className="register-overlay" />

      <Card className="register-card">
        <div className="register-header">
          <div className="register-badge">
            <Leaf className="register-badge-icon" />

            <span>Ecopraia</span>
          </div>

          <h1 className="register-title">
            Criar conta
          </h1>

          <p className="register-subtitle">
            Junte-se à orla consciente
          </p>
        </div>

        {error && (
          <div style={{ color: "#ef4444", marginBottom: "1rem", textAlign: "center" }}>
            {error}
          </div>
        )}

        <form className="register-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <Label htmlFor="name">Nome</Label>

            <Input
              id="name"
              type="text"
              placeholder="Seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              disabled={loading}
            />
          </div>

          <div className="form-field">
            <Label htmlFor="email">E-mail</Label>

            <Input
              id="email"
              type="email"
              placeholder="voce@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="form-field">
            <Label htmlFor="password">Senha</Label>

            <Input
              id="password"
              type="password"
              placeholder="••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
            />
          </div>

          <div className="form-field">
            <Label htmlFor="confirm">Confirmar senha</Label>

            <Input
              id="confirm"
              type="password"
              placeholder="••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
            />
          </div>

          <Button
            type="submit"
            className="register-button"
            disabled={loading}
          >
            {loading ? "Criando..." : "Criar conta"}
          </Button>
        </form>

        <p className="register-footer">
          Já tem conta?{" "}

          <Link
            to="/login"
            className="register-link"
          >
            Entrar
          </Link>
        </p>
      </Card>
    </main>
  );
};

export default Signup;
