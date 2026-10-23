import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components';
import { AuthPage } from './AuthPage';

export function JoinPage() {
  const { code = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .joinGroup(code)
      .then(({ groupId }) => navigate(`/groups/${groupId}`, { replace: true }))
      .catch((e: Error) => setError(e.message));
  }, [user, code, navigate]);

  if (!user) return <AuthPage banner="You've been invited to a group. Sign up or log in to join." />;
  if (error) {
    return (
      <>
        <ErrorNote message={error} />
        <Link to="/" className="btn">
          Go home
        </Link>
      </>
    );
  }
  return <Loading />;
}
